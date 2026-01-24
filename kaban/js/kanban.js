// Core Kanban Board Application
import FirebaseService from '../firebase-service.js';

class KanbanBoard {
  constructor() {
    // Инициализируем Firebase
    this.firebase = new FirebaseService();
    this.isOnline = false;

    // Загружаем данные асинхронно
    this.#listenersAttached = false;

    // Инициализируем Firebase в фоне
    this.initFirebase();

    // Сразу привязываем события и рисуем (из localStorage)
    this.setupEventListeners();
    this.setupDragAndDrop();
    this.render();
  }

  #listenersAttached = false;

  async initFirebase() {
    try {
      // Ждем инициализации SDK (коротко)
      await new Promise(resolve => {
        let attempts = 0;
        const check = () => {
          if (this.firebase.isInitialized || attempts > 50) resolve();
          else { attempts++; setTimeout(check, 100); }
        };
        check();
      });

      if (this.firebase.isInitialized) {
        console.log('🔄 Starting Firebase sync...');

        // Используем manualSync для первоначальной загрузки
        const syncResult = await this.firebase.manualSync();
        if (syncResult) {
          this.tasks = syncResult.tasks;
          this.columns = syncResult.columns;
          this.isOnline = true;
          console.log('✅ Firebase data loaded');
        }

        // Настраиваем реальное время синхронизацию
        this.firebase.setupRealtimeSync((tasks, columns) => {
          console.log('🔄 Update from Firebase');
          const serverTasks = Object.values(tasks || {});
          const serverColumns = Object.values(columns || {});

          // Обновляем только если на сервере что-то есть
          if (serverColumns.length > 0) {
            this.tasks = serverTasks;
            this.columns = serverColumns;
            this.render();
          }
        });

      } else {
        throw new Error('Firebase not initialized');
      }
    } catch (error) {
      console.log('⚠️ Using localStorage as fallback:', error);
      this.tasks = this.loadTasks();
      this.columns = this.loadColumns();
      this.isOnline = false;
    }

    // Настраиваем вебсокет для бота
    this.setupWebSocket();
  }

  setupWebSocket() {
    // Защита от множественных подключений
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        console.log('⚠️ WebSocket already connected, skipping...');
        return;
      }
      if (this.ws.readyState === WebSocket.CONNECTING) {
        console.log('⚠️ WebSocket already connecting, skipping...');
        return;
      }
      // Если соединение закрыто или в состоянии закрытия, продолжаем создание нового
      console.log('🔌 WebSocket exists but not connected, creating new connection...');
    }

    try {
      const wsUrl = 'wss://kanban-bot-pr1v.onrender.com/ws';
      console.log('🔗 Creating WebSocket connection...');

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('✅ Connected to bot server');
        this.retryCount = 0;

        // Отправить ping для проверки соединения
        this.ws.send(JSON.stringify({ type: 'PING' }));
      };

      this.ws.onmessage = (event) => {
        this.handleBotMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
      };

      this.ws.onclose = (event) => {
        console.log('🔌 WebSocket closed:', event.code, event.reason);
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

      // Экспоненциальная задержка
      const delay = Math.min(3000 * Math.pow(2, this.retryCount), 30000);
      setTimeout(() => this.setupWebSocket(), delay);
    } else {
      console.log('❌ Max reconnection attempts reached');
      // Можно показать уведомление пользователю
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
        labels: this.labels, // Добавляем список меток для бота
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

  init() {
    this.setupEventListeners()
    this.setupDragAndDrop()

    // 👇 Проверяем и удаляем старые задачи при запуске
    this.checkAndRemoveOldTasks()

    this.render()
    this.lucide.createIcons()

    // 👇 Проверяем каждые 5 минут (300000 мс)
    setInterval(() => {
      this.checkAndRemoveOldTasks()
    }, 300000)
  }

  // Data Management
  loadTasks() {
    try {
      const saved = localStorage.getItem("kanban-tasks")
      return saved ? JSON.parse(saved) : []
    } catch (e) {
      console.error('Error loading tasks:', e);
      return [];
    }
  }

  async saveTasks() {
    if (this.isOnline) {
      const success = await this.firebase.saveTasks(this.tasks);
      if (!success) {
        // Fallback на localStorage если Firebase недоступен
        localStorage.setItem("kanban-tasks", JSON.stringify(this.tasks));
      }
    } else {
      localStorage.setItem("kanban-tasks", JSON.stringify(this.tasks));
    }
  }

  loadColumns() {
    const saved = localStorage.getItem("kanban-columns");
    const columns = saved ? JSON.parse(saved) : [
      { id: "todo", title: "Этап клина", status: "todo" },
      { id: "in-progress", title: "Этап перевода", status: "in-progress" },
      { id: "done", title: "Этап редактуры", status: "done" },
      { id: "backlog", title: "Бета-рид", status: "backlog" },
      { id: "review", title: "Этап тайпа", status: "review" },
      { id: "testing", title: "Клин (ПТ, Баст, айдол)", status: "testing" }
    ];

    return columns.map((col, index) => ({
      ...col,
      order: col.order !== undefined ? col.order : index
    }));
  }

  async saveColumns() {
    if (this.isOnline) {
      const success = await this.firebase.saveColumns(this.columns);
      if (!success) {
        // Fallback на localStorage если Firebase недоступен
        localStorage.setItem("kanban-columns", JSON.stringify(this.columns));
      }
    } else {
      localStorage.setItem("kanban-columns", JSON.stringify(this.columns));
    }
  }

  // Label Management
  loadLabels() {
    const saved = localStorage.getItem("kanban-labels");
    return saved ? JSON.parse(saved) : ["Баг", "Фича", "Проект X"];
  }

  saveLabels() {
    localStorage.setItem("kanban-labels", JSON.stringify(this.labels));
    this.updateLabelSelects();
  }

  renderLabels() {
    const list = document.getElementById("labels-list");
    list.innerHTML = this.labels.map((label, index) => `
        <div class="label-item">
            <span>${label}</span>
            <button class="btn-icon delete-label-btn" data-index="${index}">
                <i data-lucide="trash-2"></i>
            </button>
        </div>
    `).join("");
    this.lucide.createIcons();

    list.querySelectorAll('.delete-label-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm(`Удалить метку "${this.labels[btn.dataset.index]}"?`)) {
          this.labels.splice(btn.dataset.index, 1);
          this.saveLabels();
          this.renderLabels();
        }
      });
    });
  }

  updateLabelSelects() {
    const selects = [document.getElementById("task-label"), document.getElementById("edit-task-label")];
    selects.forEach(select => {
      if (!select) return;
      const currentValue = select.value;
      select.innerHTML = '<option value="">Без метки</option>' +
        this.labels.map(l => `<option value="${l}">${l}</option>`).join("");
      select.value = currentValue;
    });
  }

  // Task Management
  async addTask(taskData) {
    const task = {
      id: this.generateId(),
      title: taskData.title,
      description: taskData.description,
      status: taskData.status,
      priority: taskData.priority,
      label: taskData.label || '',
      parentId: taskData.parentId || null,
      createdAt: new Date().toISOString(),
    };

    this.tasks.push(task);
    await this.saveTasks();

    // Отправляем уведомление о создании
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
    if (!confirm("Вы уверены, что хотите удалить эту задачу?")) return;

    const deleteRecursive = (id) => {
      const subtasks = this.tasks.filter(t => t.parentId === id);
      subtasks.forEach(st => deleteRecursive(st.id));
      this.tasks = this.tasks.filter(t => t.id !== id);
    };

    deleteRecursive(taskId);
    await this.saveTasks();
    this.render();
  }

  getTasksByStatus(status) {
    // Возвращаем только корневые задачи для колонки
    return this.tasks.filter((task) => task.status === status && !task.parentId);
  }

  toggleTaskExpand(taskId) {
    if (this.expandedTasks.has(taskId)) {
      this.expandedTasks.delete(taskId);
    } else {
      this.expandedTasks.add(taskId);
    }
    this.render();
  }

  // Column Management
  async addColumn(title) {
    const status = title.toLowerCase().replace(/\s+/g, "-")
    const column = {
      id: status,
      title: title,
      status: status,
      order: this.columns.length
    }

    this.columns.push(column)
    await this.saveColumns()
    this.render()
  }

  async updateColumnTitle(status, newTitle) {
    const column = this.columns.find((c) => c.status === status)
    if (column) {
      column.title = newTitle
      await this.saveColumns()
      this.render()
    }
  }

  async deleteColumn(status) {
    if (this.columns.length <= 1) return

    // Move tasks from deleted column to first available column
    const tasksInColumn = this.getTasksByStatus(status)
    if (tasksInColumn.length > 0) {
      const remainingColumns = this.columns.filter((c) => c.status !== status)
      const targetStatus = remainingColumns[0].status

      tasksInColumn.forEach((task) => {
        task.status = targetStatus
      })
      await this.saveTasks()
    }

    this.columns = this.columns.filter((c) => c.status !== status)
    await this.saveColumns()
    this.render()
  }

  // Utility Methods
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2)
  }

  // Event Listeners
  setupEventListeners() {
    if (this.#listenersAttached) return;

    // Add Task Modal
    const addTaskBtn = document.getElementById("add-task-btn");
    if (addTaskBtn) {
      addTaskBtn.addEventListener("click", () => this.openAddTaskModal());
    }

    document.getElementById("close-task-modal").addEventListener("click", () => {
      this.closeModal("add-task-modal")
    })

    document.getElementById("cancel-task").addEventListener("click", () => {
      this.closeModal("add-task-modal")
    })

    document.getElementById("add-task-form").addEventListener("submit", (e) => {
      e.preventDefault()
      this.handleAddTask(e)
    })

    // Edit Task Modal
    document.getElementById("close-edit-task-modal").addEventListener("click", () => {
      this.closeModal("edit-task-modal")
    })

    document.getElementById("cancel-edit-task").addEventListener("click", () => {
      this.closeModal("edit-task-modal")
    })

    document.getElementById("edit-task-form").addEventListener("submit", (e) => {
      e.preventDefault()
      this.handleEditTask(e)
    })

    // Add Column Modal
    const addColumnBtn = document.getElementById("add-column-btn");
    if (addColumnBtn) addColumnBtn.addEventListener("click", () => this.openAddColumnModal());

    const closeColumnBtn = document.getElementById("close-column-modal");
    if (closeColumnBtn) closeColumnBtn.addEventListener("click", () => this.closeModal("add-column-modal"));

    const cancelColumnBtn = document.getElementById("cancel-column");
    if (cancelColumnBtn) cancelColumnBtn.addEventListener("click", () => this.closeModal("add-column-modal"));

    const addColumnForm = document.getElementById("add-column-form");
    if (addColumnForm) {
      addColumnForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.handleAddColumn(e);
      });
    }

    // Edit Column Modal
    const closeEditColumnBtn = document.getElementById("close-edit-column-modal");
    if (closeEditColumnBtn) closeEditColumnBtn.addEventListener("click", () => this.closeModal("edit-column-modal"));

    const cancelEditColumnBtn = document.getElementById("cancel-edit-column");
    if (cancelEditColumnBtn) cancelEditColumnBtn.addEventListener("click", () => this.closeModal("edit-column-modal"));

    const editColumnForm = document.getElementById("edit-column-form");
    if (editColumnForm) {
      editColumnForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.handleEditColumn(e);
      });
    }

    // Manage Labels Modal
    const manageLabelsBtn = document.getElementById("manage-labels-btn");
    if (manageLabelsBtn) {
      manageLabelsBtn.addEventListener("click", () => {
        this.renderLabels();
        this.openModal("labels-modal");
      });
    }

    const closeLabelsBtn1 = document.getElementById("close-labels-modal");
    if (closeLabelsBtn1) closeLabelsBtn1.addEventListener("click", () => this.closeModal("labels-modal"));

    const closeLabelsBtn2 = document.getElementById("close-labels-btn");
    if (closeLabelsBtn2) closeLabelsBtn2.addEventListener("click", () => this.closeModal("labels-modal"));

    const addLabelBtn = document.getElementById("add-label-btn");
    if (addLabelBtn) {
      addLabelBtn.addEventListener("click", () => {
        const input = document.getElementById("new-label-name");
        if (!input) return;
        const name = input.value.trim();
        if (name && !this.labels.includes(name)) {
          this.labels.push(name);
          input.value = "";
          this.saveLabels();
          this.renderLabels();
        }
      });
    }

    document.addEventListener("click", (e) => {
      // Handle dropdown toggles
      if (e.target.closest(".dropdown-toggle")) {
        e.preventDefault()
        const dropdown = e.target.closest(".dropdown")
        const isOpen = dropdown.classList.contains("open")

        // Close all dropdowns
        document.querySelectorAll(".dropdown.open").forEach((d) => d.classList.remove("open"))

        // Toggle current dropdown
        if (!isOpen) {
          dropdown.classList.add("open")
        }
      } else if (!e.target.closest(".dropdown")) {
        // Close all dropdowns when clicking outside
        document.querySelectorAll(".dropdown.open").forEach((d) => d.classList.remove("open"))
      }

      // Close modals when clicking outside
      if (e.target.classList.contains("modal")) {
        this.closeModal(e.target.id)
      }
    })

    this.#listenersAttached = true;
  }

  // Modal Management
  openAddTaskModal() {
    this.populateStatusOptions()
    this.openModal("add-task-modal")
  }

  openAddColumnModal() {
    this.openModal("add-column-modal")
  }

  openEditColumnModal(status, currentTitle) {
    this.currentEditingColumn = status
    document.getElementById("edit-column-title").value = currentTitle
    this.openModal("edit-column-modal")
  }

  setupColumnClickHandlers() {
    document.querySelectorAll('.column-content').forEach(column => {
      column.addEventListener('click', (e) => {
        // Если кликнули именно по фону колонки, а не по карточке
        if (e.target === column) {
          const status = column.dataset.status;
          const select = document.getElementById("task-status");
          select.value = status;
          this.openAddTaskModal();
        }
      });
    });
  }

  // Modal Management
  openModal(modalId) {
    document.getElementById(modalId).classList.add("active")
    document.body.classList.add("modal-open")
  }

  closeModal(modalId) {
    document.getElementById(modalId).classList.remove("active")
    document.body.classList.remove("modal-open")

    // Reset forms
    const form = document.querySelector(`#${modalId} form`)
    if (form) form.reset()

    this.currentEditingColumn = null
  }

  populateStatusOptions() {
    const select = document.getElementById("task-status")
    select.innerHTML = ""

    this.columns.forEach((column) => {
      const option = document.createElement("option")
      option.value = column.status
      option.textContent = column.title
      select.appendChild(option)
    })

    this.updateLabelSelects();
  }

  // Form Handlers
  handleAddTask(e) {
    const formData = new FormData(e.target)
    const taskData = {
      title: formData.get("title"),
      description: formData.get("description"),
      priority: formData.get("priority"),
      status: formData.get("status"),
      label: formData.get("label") || "", // 👈 Добавляем метку (если пусто — пустая строка)
    }

    this.addTask(taskData)
    this.closeModal("add-task-modal")
  }

  openEditTaskModal(taskId) {
    const task = this.tasks.find(t => t.id === taskId)
    if (!task) return

    document.getElementById("edit-task-id").value = task.id
    document.getElementById("edit-task-title").value = task.title
    document.getElementById("edit-task-description").value = task.description || ""
    document.getElementById("edit-task-priority").value = task.priority
    document.getElementById("edit-task-status").value = task.status

    this.updateLabelSelects();
    document.getElementById("edit-task-label").value = task.label || "";

    this.populateEditStatusOptions()
    this.openModal("edit-task-modal")
  }

  populateEditStatusOptions() {
    const select = document.getElementById("edit-task-status")
    select.innerHTML = ""

    this.columns.forEach((column) => {
      const option = document.createElement("option")
      option.value = column.status
      option.textContent = column.title
      select.appendChild(option)
    })
  }

  handleEditTask(e) {
    const formData = new FormData(e.target)
    const taskId = formData.get("id")
    const updatedData = {
      title: formData.get("title"),
      description: formData.get("description"),
      priority: formData.get("priority"),
      status: formData.get("status"),
      label: formData.get("label") || ""
    }

    const taskIndex = this.tasks.findIndex(t => t.id === taskId)
    if (taskIndex !== -1) {
      this.tasks[taskIndex] = { ...this.tasks[taskIndex], ...updatedData }
      this.saveTasks()
      this.render()
      this.closeModal("edit-task-modal")
    }
  }

  handleAddColumn(e) {
    const formData = new FormData(e.target)
    const title = formData.get("title")

    if (title.trim()) {
      this.addColumn(title.trim())
      this.closeModal("add-column-modal")
    }
  }

  handleEditColumn(e) {
    const formData = new FormData(e.target)
    const newTitle = formData.get("title")

    if (newTitle.trim() && this.currentEditingColumn) {
      this.updateColumnTitle(this.currentEditingColumn, newTitle.trim())
      this.closeModal("edit-column-modal")
    }
  }

  // Rendering
  render() {
    this.renderColumns()
    this.updateLabelSelects() // Синхронизируем выпадающие списки меток
    this.lucide.createIcons() // Use the declared lucide variable
  }

  renderColumns() {
    const wrapper = document.getElementById("columns-wrapper")
    wrapper.innerHTML = ""

    // Сортируем колонки по порядку перед рендером
    const sortedColumns = [...this.columns].sort((a, b) => {
      const orderA = a.order !== undefined ? a.order : 0;
      const orderB = b.order !== undefined ? b.order : 0;
      return orderA - orderB;
    });

    sortedColumns.forEach((column) => {
      const columnElement = this.createColumnElement(column)
      wrapper.appendChild(columnElement)
    })

    this.setupColumnClickHandlers();
    this.setupDynamicEventListeners();

    console.log('Columns order:', sortedColumns.map(c => ({ title: c.title, order: c.order })));
  }

  createColumnElement(column) {
    const tasks = this.getTasksByStatus(column.status)

    const columnDiv = document.createElement("div")
    columnDiv.className = "kanban-column"
    columnDiv.dataset.status = column.status

    columnDiv.innerHTML = `
            <div class="column-header">
                <div class="column-title-wrapper">
                    <h3 class="column-title">${column.title}</h3>
                    <span class="task-count">${tasks.length}</span>
                </div>
                <div class="column-actions">
                    <button class="btn-icon edit-column-btn" data-status="${column.status}" data-title="${column.title}" title="Edit column">
                        <i data-lucide="edit-2"></i>
                    </button>
                    <button class="btn-icon delete-column-btn" data-status="${column.status}" title="Delete column">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
            <div class="column-content" data-status="${column.status}">
                ${tasks.map((task) => this.createTaskElement(task)).join("")}
            </div>
        `

    return columnDiv
  }

  createTaskElement(task) {
    const priorityClass = `priority-${task.priority}`;
    const subtasks = this.tasks.filter(t => t.parentId === task.id);
    const isExpanded = this.expandedTasks.has(task.id);
    const hasSubtasks = subtasks.length > 0;

    return `
            <div class="task-card ${priorityClass} ${hasSubtasks ? 'has-children' : ''}" data-task-id="${task.id}" draggable="true">
                <div class="task-header">
                    ${hasSubtasks ? `
                        <button class="expand-toggle ${isExpanded ? 'expanded' : ''}" data-task-id="${task.id}">
                            <i data-lucide="chevron-right"></i>
                        </button>
                    ` : ''}
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
            ? `<button class="dropdown-item move-task-btn" data-task-id="${task.id}" data-target-status="${col.status}">
                                             <i data-lucide="arrow-right"></i>
                                             Перекинуть ${col.title}
                                           </button>`
            : ""
        )
        .join("")}
                                  <button class="dropdown-item edit-task-btn" data-task-id="${task.id}">
                                     <i data-lucide="edit"></i>
                                     Редактировать
                                  </button>
                                <button class="dropdown-item delete-task-btn delete" data-task-id="${task.id}">
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
                ${hasSubtasks && isExpanded ? `
                    <div class="subtasks-container">
                        ${subtasks.map(st => this.createSubTaskElement(st)).join("")}
                    </div>
                ` : ''}
            </div>
        `
  }

  createSubTaskElement(task) {
    return `
        <div class="task-card subtask priority-${task.priority}" data-task-id="${task.id}" draggable="true">
            <div class="task-header">
                <h4 class="task-title">${task.title}</h4>
                <div class="task-actions">
                    <button class="btn-icon delete-task-btn" data-task-id="${task.id}">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
            ${task.label ? `<span class="task-label">${task.label}</span>` : ''}
        </div>
    `;
  }

  // Новый метод для привязки динамических обработчиков
  setupDynamicEventListeners() {
    // Обработчики для кнопок колонок
    document.querySelectorAll('.edit-column-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const status = e.target.closest('.edit-column-btn').dataset.status;
        const title = e.target.closest('.edit-column-btn').dataset.title;
        this.openEditColumnModal(status, title);
      });
    });

    document.querySelectorAll('.delete-column-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const status = e.target.closest('.delete-column-btn').dataset.status;
        this.deleteColumn(status);
      });
    });

    // Обработчики для кнопок задач (делегирование событий)
    document.addEventListener('click', (e) => {
      // Редактирование задачи
      if (e.target.closest('.edit-task-btn')) {
        const taskId = e.target.closest('.edit-task-btn').dataset.taskId;
        this.openEditTaskModal(taskId);
      }

      // Удаление задачи
      if (e.target.closest('.delete-task-btn')) {
        const taskId = e.target.closest('.delete-task-btn').dataset.taskId;
        this.deleteTask(taskId);
      }

      // Перемещение задачи
      if (e.target.closest('.move-task-btn')) {
        const taskId = e.target.closest('.move-task-btn').dataset.taskId;
        const targetStatus = e.target.closest('.move-task-btn').dataset.targetStatus;
        this.updateTaskStatus(taskId, targetStatus);
      }

      // Переключатель сворачивания
      if (e.target.closest('.expand-toggle')) {
        const taskId = e.target.closest('.expand-toggle').dataset.taskId;
        this.toggleTaskExpand(taskId);
      }
    });
  }

  setupDragAndDrop() {
    // Привязываем контекст ко всем обработчикам
    document.addEventListener("dragstart", (e) => {
      if (e.target.classList.contains("task-card")) {
        this.handleDragStart(e)
      }
    })

    document.addEventListener("dragover", (e) => {
      e.preventDefault()
      this.handleDragOver(e)
    })

    document.addEventListener("dragenter", (e) => {
      e.preventDefault()
      this.handleDragEnter(e)
    })

    document.addEventListener("dragleave", (e) => {
      this.handleDragLeave(e)
    })

    document.addEventListener("drop", (e) => {
      e.preventDefault()
      this.handleDrop(e) // Используем метод класса вместо анонимной функции
    })

    document.addEventListener("dragend", (e) => {
      this.handleDragEnd(e) // Используем метод класса вместо анонимной функции
    })
  }

  handleDragStart(e) {
    this.draggedTask = e.target.dataset.taskId
    this.draggedElement = e.target
    e.target.classList.add("dragging")

    // Set drag effect
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/html", e.target.outerHTML)
  }

  handleDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"

    const columnContent = e.target.closest(".column-content")
    const taskCard = e.target.closest(".task-card")

    // Снимаем старые выделения вложенности
    document.querySelectorAll('.drop-target-nest').forEach(el => el.classList.remove('drop-target-nest'));

    if (taskCard && taskCard.dataset.taskId !== this.draggedTask) {
      const rect = taskCard.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;

      // "Зона вкладывания" - центральные 50% карточки
      if (relativeY > rect.height * 0.25 && relativeY < rect.height * 0.75) {
        taskCard.classList.add('drop-target-nest');
        e.dataTransfer.dropEffect = "copy"; // Визуальный индикатор вкладывания
        return;
      }
    }

    if (columnContent && this.draggedTask) {
      const afterElement = this.getDragAfterElement(columnContent, e.clientY)
      const draggingElement = document.querySelector(".dragging")

      if (afterElement == null) {
        columnContent.appendChild(draggingElement)
      } else {
        columnContent.insertBefore(draggingElement, afterElement)
      }
    }
  }

  handleDragEnter(e) {
    const columnContent = e.target.closest(".column-content")
    if (columnContent) {
      columnContent.classList.add("drag-over")
    }
  }

  handleDragLeave(e) {
    const columnContent = e.target.closest(".column-content")
    if (columnContent && !columnContent.contains(e.relatedTarget)) {
      columnContent.classList.remove("drag-over")
    }
  }

  handleDrop(e) {
    const columnContent = e.target.closest(".column-content")
    const nestTarget = e.target.closest(".drop-target-nest")

    if (this.draggedTask) {
      if (nestTarget) {
        // Вкладывание
        const parentId = nestTarget.dataset.taskId;
        const newStatus = nestTarget.closest('.kanban-column').dataset.status;
        this.updateTaskStatus(this.draggedTask, newStatus, parentId);
        nestTarget.classList.remove('drop-target-nest');
      } else if (columnContent) {
        // Обычное перемещение
        const newStatus = columnContent.dataset.status;
        this.updateTaskStatus(this.draggedTask, newStatus, null);
      }
    }

    if (columnContent) columnContent.classList.remove("drag-over")
  }

  handleDragEnd(e) {
    if (e.target.classList.contains("task-card")) {
      e.target.classList.remove("dragging")
    }

    // Clean up drag over states
    document.querySelectorAll(".column-content").forEach((column) => {
      column.classList.remove("drag-over")
    })

    this.draggedTask = null
    this.draggedElement = null
  }

  updateTaskStatus(taskId, newStatus, newParentId = undefined) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;

    const oldStatus = task.status;
    const oldParentId = task.parentId;

    task.status = newStatus;
    if (newParentId !== undefined) {
      // Проверка на зацикливание (нельзя вложить родителя в своего потомка)
      if (newParentId === taskId) return;
      task.parentId = newParentId;
    }

    // Если задача перемещена в колонку "готово" - запоминаем дату
    const doneStatuses = ["done", "готово", "completed", "finished"];
    if (doneStatuses.includes(newStatus) && !doneStatuses.includes(oldStatus)) {
      task.movedToDoneAt = new Date().toISOString();
    }

    this.saveTasks();
    this.render();

    // Отправляем уведомление о перемещении
    if (oldStatus !== newStatus || oldParentId !== task.parentId) {
      this.trackTaskMovement(taskId, oldStatus, newStatus);
    }
  }

  getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll(".task-card:not(.dragging)")]

    return draggableElements.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect()
        const offset = y - box.top - box.height / 2

        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child }
        } else {
          return closest
        }
      },
      { offset: Number.NEGATIVE_INFINITY },
    ).element
  }

  checkAndRemoveOldTasks() {
    const now = new Date();
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(now.getDate() - 3);

    let tasksRemoved = false;
    const doneStatuses = ["done", "готово", "completed", "finished"];

    this.tasks = this.tasks.filter(task => {
      if (doneStatuses.includes(task.status)) {
        // Используем дату перемещения в "готово" или дату создания
        const relevantDate = task.movedToDoneAt ?
          new Date(task.movedToDoneAt) :
          new Date(task.createdAt);

        if (relevantDate < threeDaysAgo) {
          console.log(`🗑️ Removing task: "${task.title}" (in done since: ${relevantDate.toLocaleDateString()})`);
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

}

// Initialize the application 
document.addEventListener("DOMContentLoaded", () => {
  if (!window.kanban) {
    window.kanban = new KanbanBoard();
    console.log('✅ KanbanBoard created and attached to window');
  }
});
