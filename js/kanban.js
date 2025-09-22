// Core Kanban Board Application
class KanbanBoard {
  constructor() {
    this.tasks = this.loadTasks()
    this.columns = this.loadColumns()
    this.currentEditingColumn = null
    this.lucide = window.lucide // Declare the lucide variable
    this.draggedTask = null
    this.draggedElement = null
    this.ws = null;
    this.setupWebSocket();
    this.retryCount = 0;
    this.maxRetries = 5;
    this.syncPending = false; // 👈 Добавляем флаг синхронизации
    this.pendingSyncRequests = new Map(); // 👈 Добавляем карту ожидающих запросов

    this.init()
  }

  setupWebSocket() {
    try {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsPort = window.location.hostname === 'localhost' ? ':8080' : '';
        
        this.ws = new WebSocket(`${wsProtocol}//${window.location.hostname}${wsPort}`);
        
        this.ws.onopen = () => {
            console.log('✅ Connected to bot server');
            this.retryCount = 0;
            this.ws.send(JSON.stringify({ type: 'PING' }));
        };

        // 👇 Добавляем обработчик сообщений для синхронизации
        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log('📨 Received from server:', message.type);
                
                // Обрабатываем сообщения синхронизации
                switch (message.type) {
                    case 'SYNC_DATA':
                        this.handleSyncData(message);
                        break;
                    case 'SYNC_REQUESTED':
                        this.handleSyncRequested(message);
                        break;
                    case 'SYNC_CONFIRMED':
                        this.handleSyncConfirmed(message);
                        break;
                    default:
                        // Стандартная обработка сообщений от бота
                        this.handleBotMessage(event.data);
                        break;
                }
            } catch (error) {
                console.error('Message processing error:', error);
                // fallback to original handler
                this.handleBotMessage(event.data);
            }
        };

    } catch (error) {
        console.error('WebSocket setup error:', error);
    }
  }

  // 👇 Добавляем методы для обработки синхронизации
  handleSyncData(message) {
    if (message.tasks && message.columns) {
        console.log('🔄 Receiving sync data');
        
        // Сохраняем полученные данные
        this.tasks = message.tasks;
        this.columns = message.columns;
        
        this.saveTasks();
        this.saveColumns();
        this.render();
        
        // Подтверждаем получение
        this.sendToBot({
            type: 'SYNC_CONFIRMED',
            syncId: message.syncId,
            timestamp: new Date().toISOString()
        });
    }
  }

  handleSyncRequested(message) {
    console.log('📬 Sync requested by Mini App');
    
    // Отправляем текущее состояние
    this.sendSyncData();
  }

  handleSyncConfirmed(message) {
    if (this.pendingSyncRequests.has(message.syncId)) {
        console.log('✅ Sync confirmed:', message.syncId);
        this.pendingSyncRequests.delete(message.syncId);
        this.syncPending = false;
    }
  }

  sendSyncData() {
    const syncData = {
        type: 'SYNC_DATA',
        syncId: this.generateId(),
        tasks: this.tasks,
        columns: this.columns,
        timestamp: new Date().toISOString()
    };
    
    this.sendToBot(syncData);
  }

  requestSync() {
    const requestId = this.generateId();
    this.pendingSyncRequests.set(requestId, {
        timestamp: Date.now(),
        status: 'pending'
    });
    
    this.sendToBot({
        type: 'REQUEST_SYNC',
        requestId: requestId,
        timestamp: new Date().toISOString()
    });
    
    // Таймаут на ответ
    setTimeout(() => {
        if (this.pendingSyncRequests.has(requestId)) {
            console.log('⏰ Sync request timeout');
            this.pendingSyncRequests.delete(requestId);
        }
    }, 5000);
  }

  // 👇 Модифицируем методы изменения данных для автоматической синхронизации
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
    
    // 👇 Автоматическая синхронизация после добавления задачи
    this.sendSyncData();
    this.render();
  }

  deleteTask(taskId) {
    this.tasks = this.tasks.filter((t) => t.id !== taskId)
    this.saveTasks()
    
    // 👇 Синхронизация после удаления
    this.sendSyncData();
    this.render()
  }

  updateTaskStatus(taskId, newStatus) {
    const task = this.tasks.find(t => t.id === taskId)
    if (!task) return

    const oldStatus = task.status
    task.status = newStatus
    this.saveTasks()
    this.render()

    // Отправляем уведомление о перемещении
    if (oldStatus !== newStatus) {
        this.trackTaskMovement(taskId, oldStatus, newStatus)
    }
    
    // 👇 Синхронизация после изменения статуса
    this.sendSyncData();
  }

  // 👇 Модифицируем методы управления колонками для синхронизации
  addColumn(title) {
    const status = title.toLowerCase().replace(/\s+/g, "-")
    const column = {
      id: status,
      title: title,
      status: status,
    }

    this.columns.push(column)
    this.saveColumns()
    
    // 👇 Синхронизация после добавления колонки
    this.sendSyncData();
    this.render()
  }

  updateColumnTitle(status, newTitle) {
    const column = this.columns.find((c) => c.status === status)
    if (column) {
      column.title = newTitle
      this.saveColumns()
      
      // 👇 Синхронизация после изменения названия колонки
      this.sendSyncData();
      this.render()
    }
  }

  deleteColumn(status) {
    if (this.columns.length <= 1) return

    // Move tasks from deleted column to first available column
    const tasksInColumn = this.getTasksByStatus(status)
    if (tasksInColumn.length > 0) {
      const remainingColumns = this.columns.filter((c) => c.status !== status)
      const targetStatus = remainingColumns[0].status

      tasksInColumn.forEach((task) => {
        task.status = targetStatus
      })
      this.saveTasks()
    }

    this.columns = this.columns.filter((c) => c.status !== status)
    this.saveColumns()
    
    // 👇 Синхронизация после удаления колонки
    this.sendSyncData();
    this.render()
  }

  // 👇 Модифицируем handleEditTask для синхронизации
  handleEditTask(e) {
    const formData = new FormData(e.target)
    const taskId = formData.get("id")
    const updatedData = {
        title: formData.get("title"),
        description: formData.get("description"),
        priority: formData.get("priority"),
        status: formData.get("status")
    }

    const taskIndex = this.tasks.findIndex(t => t.id === taskId)
    if (taskIndex !== -1) {
        this.tasks[taskIndex] = { ...this.tasks[taskIndex], ...updatedData }
        this.saveTasks()
        
        // 👇 Синхронизация после редактирования задачи
        this.sendSyncData();
        this.render()
        this.closeModal("edit-task-modal")
    }
  }

  // Остальной код остается без изменений...
  // ... [все остальные методы остаются как есть] ...

}

// Initialize the application
let kanban
document.addEventListener("DOMContentLoaded", () => {
  kanban = new KanbanBoard()
  
  // 👇 Добавляем кнопку синхронизации в интерфейс, если её нет
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
    
    // Инициализируем иконку после рендера
    setTimeout(() => {
      if (window.lucide) {
        window.lucide.createIcons();
      }
    }, 100);
  }
});
