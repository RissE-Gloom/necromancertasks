// Core Kanban Board Application
class KanbanBoard {
  constructor() {
    this.isMiniApp = window.Telegram?.WebApp !== undefined;
    this.apiBase = this.isMiniApp ? 'https://kanban-bot-pr1v.onrender.com' : '';
    
    this.tasks = [];
    this.columns = [];
    this.currentEditingColumn = null;
    this.lucide = window.lucide;
    this.draggedTask = null;
    this.draggedElement = null;
    this.ws = null;
    this.retryCount = 0;
    this.maxRetries = 5;

    this.init();
  }

  async init() {
    await this.loadData();
    this.setupWebSocket();
    this.setupEventListeners();
    this.setupDragAndDrop();
    this.setupSync();
    this.checkAndRemoveOldTasks();
    this.render();
    this.lucide.createIcons();

    setInterval(() => {
        this.checkAndRemoveOldTasks();
    }, 300000);
  }

  // Data Management
  async loadData() {
    if (this.isMiniApp) {
      await this.loadFromServer();
    } else {
      this.loadFromLocalStorage();
    }
  }

  async loadFromServer() {
    try {
      console.log('📡 Loading data from server...');
      const [tasksResponse, columnsResponse] = await Promise.all([
        fetch(`${this.apiBase}/api/tasks`).catch(() => ({ ok: false })),
        fetch(`${this.apiBase}/api/columns`).catch(() => ({ ok: false }))
      ]);

      if (tasksResponse.ok) {
        const data = await tasksResponse.json();
        this.tasks = data.tasks || [];
        console.log('✅ Tasks loaded from server:', this.tasks.length);
      } else {
        this.loadFromLocalStorage();
      }

      if (columnsResponse.ok) {
        const data = await columnsResponse.json();
        this.columns = data.columns || this.getDefaultColumns();
        console.log('✅ Columns loaded from server:', this.columns.length);
      }
    } catch (error) {
      console.error('Error loading from server:', error);
      this.loadFromLocalStorage();
    }
  }

  loadFromLocalStorage() {
    const savedTasks = localStorage.getItem("kanban-tasks");
    this.tasks = savedTasks ? JSON.parse(savedTasks) : [];
    console.log('📦 Tasks loaded from localStorage:', this.tasks.length);

    const savedColumns = localStorage.getItem("kanban-columns");
    this.columns = savedColumns ? JSON.parse(savedColumns) : this.getDefaultColumns();
  }

  getDefaultColumns() {
    return [
      { id: "todo", title: "To Do", status: "todo" },
      { id: "in-progress", title: "In Progress", status: "in-progress" },
      { id: "done", title: "Done", status: "done" },
    ];
  }

  async saveData() {
    if (this.isMiniApp) {
      await this.saveToServer();
    } else {
      this.saveToLocalStorage();
    }
  }

  async saveToServer() {
    try {
      await Promise.all([
        fetch(`${this.apiBase}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks: this.tasks })
        }).catch(() => {}),
        fetch(`${this.apiBase}/api/columns`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ columns: this.columns })
        }).catch(() => {})
      ]);
    } catch (error) {
      console.error('Error saving to server:', error);
    }
  }

  saveToLocalStorage() {
    localStorage.setItem("kanban-tasks", JSON.stringify(this.tasks));
    localStorage.setItem("kanban-columns", JSON.stringify(this.columns));
    
    // Триггерим событие для других вкладок
    if (!this.isMiniApp) {
      window.dispatchEvent(new Event('storage'));
    }
  }

  setupSync() {
    if (!this.isMiniApp) {
      // Синхронизация между вкладками браузера
      window.addEventListener('storage', (e) => {
        if (e.key === 'kanban-tasks' || e.key === 'kanban-columns') {
          console.log('🔄 Storage changed, reloading data...');
          this.loadFromLocalStorage();
          this.render();
        }
      });
    } else {
      // Периодическая синхронизация для Mini App
      setInterval(async () => {
        console.log('🔄 Syncing with server...');
        await this.loadData();
        this.render();
      }, 10000); // Синхронизация каждые 10 секунд
    }
  }

  // WebSocket методы остаются без изменений
  setupWebSocket() {
    try {
        const renderUrl = 'wss://kanban-bot-pr1v.onrender.com';
        console.log('🔗 Connecting to WebSocket:', renderUrl);
        
        this.ws = new WebSocket(renderUrl);
        
        this.ws.onopen = () => {
            console.log('✅ Connected to bot server');
            this.retryCount = 0;
            this.ws.send(JSON.stringify({ type: 'PING' }));
        };

        this.ws.onmessage = (event) => {
            this.handleBotMessage(event.data);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onclose = () => {
            console.log('❌ Disconnected from bot server');
            this.attemptReconnect();
        };

    } catch (error) {
        console.error('WebSocket setup error:', error);
    }
  }

  attemptReconnect() {
    if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        console.log(`🔁 Attempting reconnect (${this.retryCount}/${this.maxRetries})...`);
        setTimeout(() => this.setupWebSocket(), 3000);
    } else {
        console.log('❌ Max reconnection attempts reached');
    }
  }

  handleBotMessage(data) {
    try {
        const message = JSON.parse(data);
        console.log('📨 Received from bot:', message.type);
        
        switch (message.type) {
            case 'REQUEST_STATUS':
                this.sendStatus(message.chatId);
                break;
                
            case 'REQUEST_COLUMN_STATUS':
                this.sendColumnStatus(message.chatId, message.columnStatus);
                break;
                
            case 'CONNECTION_ESTABLISHED':
                console.log('✅ Connection confirmed by bot server');
                break;
        }
    } catch (error) {
        console.error('Message handling error:', error);
    }
  }

  sendColumnStatus(chatId, columnStatus) {
    try {
        const column = this.columns.find(col => col.status === columnStatus);
        if (!column) return;

        const tasks = this.getTasksByStatus(columnStatus);
        const columnData = {
            id: column.id,
            title: column.title,
            status: column.status,
            taskCount: tasks.length,
            tasks: tasks.map(task => ({
                id: task.id,
                title: task.title,
                priority: task.priority,
                label: task.label || '',
                description: task.description || ''
            }))
        };

        const response = {
            type: 'COLUMN_STATUS_RESPONSE',
            chatId: chatId,
            column: columnData,
            timestamp: new Date().toISOString()
        };
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(response));
            console.log('📤 Column status sent:', columnStatus);
        }
    } catch (error) {
        console.error('Error sending column status:', error);
    }
  }

  sendStatus(chatId = null) {
    try {
        const status = {
            type: 'STATUS_RESPONSE',
            chatId: chatId,
            columns: this.columns.map(column => {
                const tasks = this.getTasksByStatus(column.status);
                return {
                    id: column.id,
                    title: column.title,
                    status: column.status,
                    taskCount: tasks.length
                };
            }),
            timestamp: new Date().toISOString()
        };
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(status));
            console.log('📤 Status sent to bot');
        }
    } catch (error) {
        console.error('Error sending status:', error);
    }
  }

  trackTaskMovement(taskId, fromStatus, toStatus) {
    const task = this.tasks.find(t => t.id === taskId)
    if (!task) return

    const activity = {
        type: 'TASK_MOVED',
        taskId,
        fromStatus,
        toStatus,
        timestamp: new Date().toISOString(),
        task: {
            id: task.id,
            title: task.title,
            priority: task.priority,
            label: task.label || ''
        }
    };
    
    console.log('🔄 Tracking task movement:', activity);
    this.sendToBot(activity);
  }

  sendToBot(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(message));
        console.log('📤 Sent to bot:', message.type);
    }
  }

  // Task Management с async/await
  async addTask(taskData) {
    const task = {
        id: this.generateId(),
        title: taskData.title,
        description: taskData.description,
        status: taskData.status,
        priority: taskData.priority,
        label: taskData.label || '',
        createdAt: new Date().toISOString(),
    };

    this.tasks.push(task);
    await this.saveData();
    
    this.sendToBot({
        type: 'TASK_CREATED',
        taskId: task.id,
        status: task.status,
        timestamp: task.createdAt,
        task: {
            id: task.id,
            title: task.title,
            label: task.label || ''
        }
    });
    
    this.render();
  }

  async deleteTask(taskId) {
    this.tasks = this.tasks.filter((t) => t.id !== taskId);
    await this.saveData();
    this.render();
  }

  getTasksByStatus(status) {
    return this.tasks.filter((task) => task.status === status);
  }

  // Column Management с async/await
  async addColumn(title) {
    const status = title.toLowerCase().replace(/\s+/g, "-");
    const column = {
      id: status,
      title: title,
      status: status,
    };

    this.columns.push(column);
    await this.saveData();
    this.render();
  }

  async updateColumnTitle(status, newTitle) {
    const column = this.columns.find((c) => c.status === status);
    if (column) {
      column.title = newTitle;
      await this.saveData();
      this.render();
    }
  }

  async deleteColumn(status) {
    if (this.columns.length <= 1) return;

    const tasksInColumn = this.getTasksByStatus(status);
    if (tasksInColumn.length > 0) {
      const remainingColumns = this.columns.filter((c) => c.status !== status);
      const targetStatus = remainingColumns[0].status;

      tasksInColumn.forEach((task) => {
        task.status = targetStatus;
      });
      await this.saveData();
    }

    this.columns = this.columns.filter((c) => c.status !== status);
    await this.saveData();
    this.render();
  }

  // Utility Methods
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Event Listeners (без изменений)
  setupEventListeners() {
    // ... существующий код без изменений ...
  }

  // Modal Management (без изменений)
  openAddTaskModal() {
    this.populateStatusOptions();
    this.openModal("add-task-modal");
  }

  // ... остальные методы modal management без изменений ...

  // Form Handlers с async/await
  async handleAddTask(e) {
    const formData = new FormData(e.target);
    const taskData = {
        title: formData.get("title"),
        description: formData.get("description"),
        priority: formData.get("priority"),
        status: formData.get("status"),
        label: formData.get("label") || "",
    };

    await this.addTask(taskData);
    this.closeModal("add-task-modal");
  }

  async handleEditTask(e) {
    const formData = new FormData(e.target);
    const taskId = formData.get("id");
    const updatedData = {
        title: formData.get("title"),
        description: formData.get("description"),
        priority: formData.get("priority"),
        status: formData.get("status")
    };

    const taskIndex = this.tasks.findIndex(t => t.id === taskId);
    if (taskIndex !== -1) {
        this.tasks[taskIndex] = { ...this.tasks[taskIndex], ...updatedData };
        await this.saveData();
        this.render();
        this.closeModal("edit-task-modal");
    }
  }

  async handleAddColumn(e) {
    const formData = new FormData(e.target);
    const title = formData.get("title");

    if (title.trim()) {
      await this.addColumn(title.trim());
      this.closeModal("add-column-modal");
    }
  }

  async handleEditColumn(e) {
    const formData = new FormData(e.target);
    const newTitle = formData.get("title");

    if (newTitle.trim() && this.currentEditingColumn) {
      await this.updateColumnTitle(this.currentEditingColumn, newTitle.trim());
      this.closeModal("edit-column-modal");
    }
  }

  // Rendering (без изменений)
  render() {
    this.renderColumns();
    this.lucide.createIcons();
  }

  renderColumns() {
    const wrapper = document.getElementById("columns-wrapper");
    wrapper.innerHTML = "";

    this.columns.forEach((column) => {
      const columnElement = this.createColumnElement(column);
      wrapper.appendChild(columnElement);
    });
  }

  createColumnElement(column) {
    const tasks = this.getTasksByStatus(column.status);

    const columnDiv = document.createElement("div");
    columnDiv.className = "kanban-column";
    columnDiv.dataset.status = column.status;

    columnDiv.innerHTML = `
            <div class="column-header">
                <div class="column-title-wrapper">
                    <h3 class="column-title">${column.title}</h3>
                    <span class="task-count">${tasks.length}</span>
                </div>
                <div class="column-actions">
                    <button class="btn-icon" onclick="kanban.openEditColumnModal('${column.status}', '${column.title}')" title="Edit column">
                        <i data-lucide="edit-2"></i>
                    </button>
                    <button class="btn-icon" onclick="kanban.deleteColumn('${column.status}')" title="Delete column">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
            <div class="column-content" data-status="${column.status}">
                ${tasks.map((task) => this.createTaskElement(task)).join("")}
            </div>
        `;

    return columnDiv;
  }

  createTaskElement(task) {
    const priorityClass = `priority-${task.priority}`;

    return `
            <div class="task-card ${priorityClass}" data-task-id="${task.id}" draggable="true">
                <div class="task-header">
                    <h4 class="task-title">${task.title}</h4>
                    <div class="task-actions">
                        <div class="dropdown">
                            <button class="btn-icon dropdown-toggle" title="Task options">
                                <i data-lucide="more-horizontal"></i>
                            </button>
                            <div class="dropdown-menu">
                                ${this.columns
                                  .map((col) =>
                                    col.status !== task.status
                                      ? `<button class="dropdown-item" onclick="kanban.updateTaskStatus('${task.id}', '${col.status}')">
                                             <i data-lucide="arrow-right"></i>
                                             Перекинуть ${col.title}
                                           </button>`
                                      : "",
                                  )
                                  .join("")}
                                  <button class="dropdown-item" onclick="kanban.openEditTaskModal('${task.id}')">
                                     <i data-lucide="edit"></i>
                                     Редактировать
                                  </button>
                                <button class="dropdown-item delete" onclick="kanban.deleteTask('${task.id}')">
                                    <i data-lucide="trash-2"></i>
                                    Удалить
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                ${task.description ? `<p class="task-description">${task.description}</p>` : ""}
                <div class="task-footer">
                    <span class="task-priority priority-${task.priority}">${task.priority}</span>
                    ${task.label ? `<span class="task-label">${task.label}</span>` : ''} 
                </div>
            </div>
        `;
  }

  // Drag and Drop (без изменений)
  setupDragAndDrop() {
    // ... существующий код без изменений ...
  }

  handleDragStart(e) {
    // ... существующий код без изменений ...
  }

  // ... остальные drag and drop методы без изменений ...

  async updateTaskStatus(taskId, newStatus) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;

    const oldStatus = task.status;
    task.status = newStatus;
    await this.saveData();
    this.render();

    if (oldStatus !== newStatus) {
        this.trackTaskMovement(taskId, oldStatus, newStatus);
    }
  }

  getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll(".task-card:not(.dragging)")];

    return draggableElements.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;

        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child };
        } else {
          return closest;
        }
      },
      { offset: Number.NEGATIVE_INFINITY },
    ).element;
  }

  async checkAndRemoveOldTasks() {
    const now = new Date();
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(now.getDate() - 3);

    let tasksRemoved = false;

    this.tasks = this.tasks.filter(task => {
        if (task.status === "done") {
            const createdAt = new Date(task.createdAt);
            if (createdAt < threeDaysAgo) {
                tasksRemoved = true;
                return false;
            }
        }
        return true;
    });

    if (tasksRemoved) {
        await this.saveData();
        this.render();
    }
  }
}

// Initialize the application
let kanban;
document.addEventListener("DOMContentLoaded", () => {
  kanban = new KanbanBoard();
});
