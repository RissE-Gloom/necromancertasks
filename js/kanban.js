// Core Kanban Board Application
class KanbanBoard {
  constructor() {
    // Сначала объявляем свойства
    this.tasks = [];
    this.columns = [];
    this.currentEditingColumn = null;
    this.lucide = window.lucide;
    this.draggedTask = null;
    this.draggedElement = null;
    this.ws = null;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.syncPending = false;
    this.pendingSyncRequests = new Map();
    this.clientType = 'browser';

    // Затем инициализируем данные
    this.loadData();
    
    // И только потом настраиваем остальное
    this.setupWebSocket();
    this.init();
  }

  // Data Management
  loadData() {
    this.tasks = this.loadTasks();
    this.columns = this.loadColumns();
  }

  loadTasks() {
    const saved = localStorage.getItem("kanban-tasks");
    return saved ? JSON.parse(saved) : [];
  }

  saveTasks() {
    localStorage.setItem("kanban-tasks", JSON.stringify(this.tasks));
  }

  loadColumns() {
    const saved = localStorage.getItem("kanban-columns");
    return saved
      ? JSON.parse(saved)
      : [
          { id: "todo", title: "To Do", status: "todo" },
          { id: "in-progress", title: "In Progress", status: "in-progress" },
          { id: "done", title: "Done", status: "done" },
        ];
  }

  saveColumns() {
    localStorage.setItem("kanban-columns", JSON.stringify(this.columns));
  }

  // Utility Methods
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // WebSocket Configuration
  setupWebSocket() {
    try {
        const wsServerUrl = 'wss://kanban-bot-pr1v.onrender.com';
        const isMiniApp = window.Telegram?.WebApp?.initData || window.location.search.includes('miniApp=true');
        
        const wsUrl = `${wsServerUrl}?clientType=${isMiniApp ? 'miniApp' : 'browser'}`;
        
        console.log('🔗 Connecting to WebSocket:', wsUrl);
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('✅ Connected to bot server');
            this.retryCount = 0;
            this.ws.send(JSON.stringify({ type: 'PING' }));
            
            if (isMiniApp) {
                this.requestSync();
            }
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log('📨 Received from server:', message.type);
                
                switch (message.type) {
                    case 'SYNC_DATA':
                        this.handleSyncData(message);
                        break;
                    case 'SYNC_REQUESTED':
                        if (!isMiniApp) {
                            this.handleSyncRequested(message);
                        }
                        break;
                    case 'SYNC_CONFIRMED':
                        this.handleSyncConfirmed(message);
                        break;
                    case 'CONNECTION_ESTABLISHED':
                        console.log('✅ Connection confirmed by server');
                        if (message.clientType) {
                            this.clientType = message.clientType;
                        }
                        break;
                    case 'TASK_MOVED':
                    case 'TASK_CREATED':
                    case 'TASK_UPDATED':
                    case 'TASK_DELETED':
                        if (isMiniApp) {
                            this.handleChangeNotification(message);
                        }
                        break;
                    default:
                        this.handleBotMessage(event.data);
                        break;
                }
            } catch (error) {
                console.error('Message processing error:', error);
                this.handleBotMessage(event.data);
            }
        };

        this.ws.onclose = (event) => {
            console.log('❌ WebSocket disconnected:', event.code, event.reason);
            this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
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
        this.showConnectionError();
    }
  }

  showConnectionError() {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'connection-error';
    errorDiv.innerHTML = `
        <div style="position: fixed; top: 20px; right: 20px; background: #ff4757; color: white; padding: 15px; border-radius: 8px; z-index: 10000; max-width: 300px;">
            <strong>❌ Нет подключения к серверу</strong>
            <p style="margin: 5px 0; font-size: 14px;">Канбан-доска работает в автономном режиме</p>
            <button onclick="kanban.setupWebSocket()" style="background: white; color: #ff4757; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Повторить</button>
        </div>
    `;
    document.body.appendChild(errorDiv);
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

  trackTaskMovement(taskId, fromStatus, toStatus) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;

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

  // Sync Methods
  handleSyncData(message) {
    if (message.tasks && message.columns) {
        console.log('🔄 Receiving sync data');
        
        this.tasks = message.tasks;
        this.columns = message.columns;
        
        this.saveTasks();
        this.saveColumns();
        this.render();
        
        if (message.syncId && !this.pendingSyncRequests.has(message.syncId)) {
            this.sendToBot({
                type: 'SYNC_CONFIRMED',
                syncId: message.syncId,
                timestamp: new Date().toISOString()
            });
        }
    }
  }

  handleSyncRequested(message) {
    console.log('📬 Sync requested by Mini App');
    this.sendSyncData(message.requestId);
  }

  handleSyncConfirmed(message) {
    if (this.pendingSyncRequests.has(message.syncId)) {
        console.log('✅ Sync confirmed:', message.syncId);
        this.pendingSyncRequests.delete(message.syncId);
        this.syncPending = false;
        this.updateSyncButton(false);
    }
  }

  handleChangeNotification(message) {
    console.log('📝 Processing change notification:', message.type);
    
    switch (message.type) {
        case 'TASK_MOVED':
            this.applyTaskMove(message);
            break;
        case 'TASK_CREATED':
            this.applyTaskCreate(message);
            break;
        case 'TASK_UPDATED':
            this.applyTaskUpdate(message);
            break;
        case 'TASK_DELETED':
            this.applyTaskDelete(message);
            break;
    }
  }

  applyTaskMove(message) {
    const task = this.tasks.find(t => t.id === message.taskId);
    if (task && task.status !== message.toStatus) {
        task.status = message.toStatus;
        this.saveTasks();
        this.render();
    }
  }

  applyTaskCreate(message) {
    const existingTask = this.tasks.find(t => t.id === message.task.id);
    if (!existingTask) {
        this.tasks.push({
            ...message.task,
            createdAt: message.timestamp,
            description: message.task.description || '',
            label: message.task.label || ''
        });
        this.saveTasks();
        this.render();
    }
  }

  applyTaskUpdate(message) {
    const taskIndex = this.tasks.findIndex(t => t.id === message.taskId);
    if (taskIndex !== -1) {
        this.tasks[taskIndex] = { ...this.tasks[taskIndex], ...message.updatedData };
        this.saveTasks();
        this.render();
    }
  }

  applyTaskDelete(message) {
    this.tasks = this.tasks.filter(t => t.id !== message.taskId);
    this.saveTasks();
    this.render();
  }

  sendSyncData(requestId = null) {
    const syncData = {
        type: 'SYNC_DATA',
        syncId: this.generateId(),
        tasks: this.tasks,
        columns: this.columns,
        timestamp: new Date().toISOString()
    };
    
    if (requestId) {
        syncData.requestId = requestId;
    }
    
    this.sendToBot(syncData);
  }

  requestSync() {
    const requestId = this.generateId();
    this.pendingSyncRequests.set(requestId, {
        timestamp: Date.now(),
        status: 'pending'
    });
    
    this.updateSyncButton(true);
    
    this.sendToBot({
        type: 'REQUEST_SYNC',
        requestId: requestId,
        timestamp: new Date().toISOString()
    });
    
    setTimeout(() => {
        if (this.pendingSyncRequests.has(requestId)) {
            console.log('⏰ Sync request timeout');
            this.pendingSyncRequests.delete(requestId);
            this.updateSyncButton(false);
        }
    }, 5000);
  }

  updateSyncButton(isSyncing) {
    const syncButton = document.getElementById('sync-btn');
    if (syncButton) {
        if (isSyncing) {
            syncButton.innerHTML = '<i data-lucide="loader" class="spin"></i> Синхронизация...';
            syncButton.disabled = true;
        } else {
            syncButton.innerHTML = '<i data-lucide="refresh-cw"></i> Синхронизировать';
            syncButton.disabled = false;
        }
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }
  }

  sendToBot(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(message));
        console.log('📤 Sent to bot:', message.type);
    } else {
        console.warn('⚠️ WebSocket not connected, message not sent:', message.type);
    }
  }

  // Event Listeners - ДОБАВЛЯЕМ недостающие методы
  setupEventListeners() {
    // Add Task Modal
    document.getElementById("add-task-btn")?.addEventListener("click", () => {
      this.openAddTaskModal();
    });

    document.getElementById("close-task-modal")?.addEventListener("click", () => {
      this.closeModal("add-task-modal");
    });

    document.getElementById("cancel-task")?.addEventListener("click", () => {
      this.closeModal("add-task-modal");
    });

    document.getElementById("add-task-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleAddTask(e);
    });

    // Edit Task Modal
    document.getElementById("close-edit-task-modal")?.addEventListener("click", () => {
      this.closeModal("edit-task-modal");
    });

    document.getElementById("cancel-edit-task")?.addEventListener("click", () => {
      this.closeModal("edit-task-modal");
    });

    document.getElementById("edit-task-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleEditTask(e);
    });

    // Add Column Modal
    document.getElementById("add-column-btn")?.addEventListener("click", () => {
      this.openAddColumnModal();
    });

    document.getElementById("close-column-modal")?.addEventListener("click", () => {
      this.closeModal("add-column-modal");
    });

    document.getElementById("cancel-column")?.addEventListener("click", () => {
      this.closeModal("add-column-modal");
    });

    document.getElementById("add-column-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleAddColumn(e);
    });

    // Edit Column Modal
    document.getElementById("close-edit-column-modal")?.addEventListener("click", () => {
      this.closeModal("edit-column-modal");
    });

    document.getElementById("cancel-edit-column")?.addEventListener("click", () => {
      this.closeModal("edit-column-modal");
    });

    document.getElementById("edit-column-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleEditColumn(e);
    });

    document.addEventListener("click", (e) => {
      if (e.target.closest(".dropdown-toggle")) {
        e.preventDefault();
        const dropdown = e.target.closest(".dropdown");
        const isOpen = dropdown.classList.contains("open");

        document.querySelectorAll(".dropdown.open").forEach((d) => d.classList.remove("open"));

        if (!isOpen) {
          dropdown.classList.add("open");
        }
      } else if (!e.target.closest(".dropdown")) {
        document.querySelectorAll(".dropdown.open").forEach((d) => d.classList.remove("open"));
      }

      if (e.target.classList.contains("modal")) {
        this.closeModal(e.target.id);
      }
    });
  }

  setupDragAndDrop() {
    document.addEventListener("dragstart", (e) => {
        if (e.target.classList.contains("task-card")) {
            this.handleDragStart(e);
        }
    });

    document.addEventListener("dragover", (e) => {
        e.preventDefault();
        this.handleDragOver(e);
    });

    document.addEventListener("dragenter", (e) => {
        e.preventDefault();
        this.handleDragEnter(e);
    });

    document.addEventListener("dragleave", (e) => {
        this.handleDragLeave(e);
    });

    document.addEventListener("drop", (e) => {
        e.preventDefault();
        this.handleDrop(e);
    });

    document.addEventListener("dragend", (e) => {
        this.handleDragEnd(e);
    });
  }

  handleDragStart(e) {
    this.draggedTask = e.target.dataset.taskId;
    this.draggedElement = e.target;
    e.target.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/html", e.target.outerHTML);
  }

  handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const columnContent = e.target.closest(".column-content");
    if (columnContent && this.draggedTask) {
      const afterElement = this.getDragAfterElement(columnContent, e.clientY);
      const draggingElement = document.querySelector(".dragging");

      if (afterElement == null) {
        columnContent.appendChild(draggingElement);
      } else {
        columnContent.insertBefore(draggingElement, afterElement);
      }
    }
  }

  handleDragEnter(e) {
    const columnContent = e.target.closest(".column-content");
    if (columnContent) {
      columnContent.classList.add("drag-over");
    }
  }

  handleDragLeave(e) {
    const columnContent = e.target.closest(".column-content");
    if (columnContent && !columnContent.contains(e.relatedTarget)) {
      columnContent.classList.remove("drag-over");
    }
  }

  handleDrop(e) {
    console.log('🖱️ Drop event triggered');
    const columnContent = e.target.closest(".column-content");
    console.log('Column content:', columnContent);
    console.log('Dragged task:', this.draggedTask);
    
    if (columnContent && this.draggedTask) {
        const newStatus = columnContent.dataset.status;
        console.log('New status:', newStatus);
        this.updateTaskStatus(this.draggedTask, newStatus);
        columnContent.classList.remove("drag-over");
    }
  }

  handleDragEnd(e) {
    if (e.target.classList.contains("task-card")) {
        e.target.classList.remove("dragging");
    }

    document.querySelectorAll(".column-content").forEach((column) => {
        column.classList.remove("drag-over");
    });

    this.draggedTask = null;
    this.draggedElement = null;
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

  // Modal Management
  openAddTaskModal() {
    this.populateStatusOptions();
    this.openModal("add-task-modal");
  }

  openAddColumnModal() {
    this.openModal("add-column-modal");
  }

  openEditColumnModal(status, currentTitle) {
    this.currentEditingColumn = status;
    document.getElementById("edit-column-title").value = currentTitle;
    this.openModal("edit-column-modal");
  }

  openEditTaskModal(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;

    document.getElementById("edit-task-id").value = task.id;
    document.getElementById("edit-task-title").value = task.title;
    document.getElementById("edit-task-description").value = task.description || "";
    document.getElementById("edit-task-priority").value = task.priority;
    document.getElementById("edit-task-status").value = task.status;

    this.populateEditStatusOptions();
    this.openModal("edit-task-modal");
  }

  openModal(modalId) {
    document.getElementById(modalId)?.classList.add("active");
    document.body.classList.add("modal-open");
  }

  closeModal(modalId) {
    document.getElementById(modalId)?.classList.remove("active");
    document.body.classList.remove("modal-open");

    const form = document.querySelector(`#${modalId} form`);
    if (form) form.reset();

    this.currentEditingColumn = null;
  }

  populateStatusOptions() {
    const select = document.getElementById("task-status");
    if (!select) return;
    
    select.innerHTML = "";

    this.columns.forEach((column) => {
      const option = document.createElement("option");
      option.value = column.status;
      option.textContent = column.title;
      select.appendChild(option);
    });
  }

  populateEditStatusOptions() {
    const select = document.getElementById("edit-task-status");
    if (!select) return;
    
    select.innerHTML = "";

    this.columns.forEach((column) => {
        const option = document.createElement("option");
        option.value = column.status;
        option.textContent = column.title;
        select.appendChild(option);
    });
  }

  // Form Handlers
  handleAddTask(e) {
    const formData = new FormData(e.target);
    const taskData = {
        title: formData.get("title"),
        description: formData.get("description"),
        priority: formData.get("priority"),
        status: formData.get("status"),
        label: formData.get("label") || "",
    };

    this.addTask(taskData);
    this.closeModal("add-task-modal");
  }

  handleEditTask(e) {
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
        this.saveTasks();
        this.sendToBot({
            type: 'TASK_UPDATED',
            taskId: taskId,
            updatedData: updatedData,
            timestamp: new Date().toISOString()
        });
        this.render();
        this.closeModal("edit-task-modal");
    }
  }

  handleAddColumn(e) {
    const formData = new FormData(e.target);
    const title = formData.get("title");

    if (title.trim()) {
      this.addColumn(title.trim());
      this.closeModal("add-column-modal");
    }
  }

  handleEditColumn(e) {
    const formData = new FormData(e.target);
    const newTitle = formData.get("title");

    if (newTitle.trim() && this.currentEditingColumn) {
      this.updateColumnTitle(this.currentEditingColumn, newTitle.trim());
      this.closeModal("edit-column-modal");
    }
  }

  // Task Management
  addTask(taskData) {
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
    this.saveTasks();
    
    this.sendToBot({
        type: 'TASK_CREATED',
        taskId: task.id,
        status: task.status,
        timestamp: task.createdAt,
        task: {
            id: task.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            label: task.label
        }
    });
    
    this.render();
  }

  deleteTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
        this.tasks = this.tasks.filter((t) => t.id !== taskId);
        this.saveTasks();
        
        this.sendToBot({
            type: 'TASK_DELETED',
            taskId: taskId,
            timestamp: new Date().toISOString()
        });
        
        this.render();
    }
  }

  getTasksByStatus(status) {
    return this.tasks.filter((task) => task.status === status);
  }

  updateTaskStatus(taskId, newStatus) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;

    const oldStatus = task.status;
    task.status = newStatus;
    this.saveTasks();
    this.render();

    if (oldStatus !== newStatus) {
        this.trackTaskMovement(taskId, oldStatus, newStatus);
    }
  }

  // Column Management
  addColumn(title) {
    const status = title.toLowerCase().replace(/\s+/g, "-");
    const column = {
      id: status,
      title: title,
      status: status,
    };

    this.columns.push(column);
    this.saveColumns();
    this.render();
    this.sendSyncData();
  }

  updateColumnTitle(status, newTitle) {
    const column = this.columns.find((c) => c.status === status);
    if (column) {
      column.title = newTitle;
      this.saveColumns();
      this.render();
      this.sendSyncData();
    }
  }

  deleteColumn(status) {
    if (this.columns.length <= 1) return;

    const tasksInColumn = this.getTasksByStatus(status);
    if (tasksInColumn.length > 0) {
      const remainingColumns = this.columns.filter((c) => c.status !== status);
      const targetStatus = remainingColumns[0].status;

      tasksInColumn.forEach((task) => {
        task.status = targetStatus;
      });
      this.saveTasks();
    }

    this.columns = this.columns.filter((c) => c.status !== status);
    this.saveColumns();
    this.render();
    this.sendSyncData();
  }

  // Rendering
  render() {
    this.renderColumns();
    if (this.lucide) {
        this.lucide.createIcons();
    }
  }

  renderColumns() {
    const wrapper = document.getElementById("columns-wrapper");
    if (!wrapper) return;
    
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
                                      : ""
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

  checkAndRemoveOldTasks() {
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
        this.saveTasks();
        this.render();
    }
  }

  init() {
    this.setupEventListeners();
    this.setupDragAndDrop();
    this.checkAndRemoveOldTasks();
    this.render();
    if (this.lucide) {
        this.lucide.createIcons();
    }

    setInterval(() => {
        this.checkAndRemoveOldTasks();
    }, 300000);
  }
}

// Initialize the application
let kanban;
document.addEventListener("DOMContentLoaded", () => {
  kanban = new KanbanBoard();
  
  if (!document.getElementById('sync-btn')) {
    const syncButton = document.createElement('button');
    syncButton.id = 'sync-btn';
    syncButton.className = 'btn sync-btn';
    syncButton.innerHTML = '<i data-lucide="refresh-cw"></i> Синхронизировать';
    syncButton.style.position = 'fixed';
    syncButton.style.bottom = '20px';
    syncButton.style.right = '20px';
    syncButton.style.zIndex = '1000';
    syncButton.onclick = () => kanban.requestSync();
    
    document.body.appendChild(syncButton);
    
    setTimeout(() => {
      if (window.lucide) {
        window.lucide.createIcons();
      }
    }, 100);
  }
});

const style = document.createElement('style');
style.textContent = `
.sync-btn {
  background: #007bff;
  color: white;
  padding: 12px 16px;
  border-radius: 50px;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 123, 255, 0.3);
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  transition: all 0.3s ease;
}

.sync-btn:hover:not(:disabled) {
  background: #0056b3;
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 123, 255, 0.4);
}

.sync-btn:active:not(:disabled) {
  transform: translateY(0);
}

.sync-btn:disabled {
  background: #6c757d;
  cursor: not-allowed;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.connection-error {
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
}
`;
document.head.appendChild(style);
