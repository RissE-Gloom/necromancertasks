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

  // WebSocket Configuration - ИСПРАВЛЕННЫЙ МЕТОД
  setupWebSocket() {
    try {
        // 👇 Указываем явный URL вашего WebSocket сервера на Render
        const wsServerUrl = 'wss://kanban-bot-pr1v.onrender.com'; // ЗАМЕНИТЕ на ваш реальный URL
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
    // Показываем сообщение об ошибке подключения
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

  // Остальные методы остаются без изменений...
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

  // ... остальные методы класса (init, addTask, deleteTask, и т.д.) ...
  // Они остаются без изменений, просто убедитесь, что они есть в классе

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

  // ... и так далее для всех остальных методов
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
