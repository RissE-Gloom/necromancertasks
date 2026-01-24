// firebase-service.js
import { firebaseConfig } from './firebase-config.js';

class FirebaseService {
    constructor() {
        this.isInitialized = false;
        this.init();
    }

    async init() {
        try {
            // Динамически загружаем Firebase SDK
            await this.loadFirebaseSDK();
            
            this.app = window.firebase.initializeApp(firebaseConfig);
            this.db = window.firebase.database();
            this.isInitialized = true;
            
            console.log('✅ Firebase initialized successfully');
        } catch (error) {
            console.error('❌ Firebase initialization failed:', error);
        }
    }

    loadFirebaseSDK() {
        return new Promise((resolve, reject) => {
            if (window.firebase) {
                resolve();
                return;
            }

            // Загружаем Firebase SDK динамически
            const script = document.createElement('script');
            script.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js';
            script.onload = () => {
                const scriptDatabase = document.createElement('script');
                scriptDatabase.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js';
                scriptDatabase.onload = resolve;
                scriptDatabase.onerror = reject;
                document.head.appendChild(scriptDatabase);
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // Методы для работы с данными...
    async saveTasks(tasks) {
        if (!this.isInitialized) {
            console.warn('Firebase not initialized');
            return false;
        }

        try {
            const tasksObj = {};
            tasks.forEach(task => {
                tasksObj[task.id] = task;
            });
            
            await this.db.ref(`projects/default/tasks`).set(tasksObj);
            await this.updateTimestamp();
            return true;
        } catch (error) {
            console.error('Error saving tasks:', error);
            return false;
        }
    }

    async loadTasks() {
        return new Promise((resolve) => {
            if (!this.isInitialized) {
                resolve([]);
                return;
            }

            this.db.ref('projects/default/tasks').once('value')
                .then(snapshot => {
                    const data = snapshot.val();
                    const tasks = data ? Object.values(data) : [];
                    resolve(tasks);
                })
                .catch(error => {
                    console.error('Error loading tasks:', error);
                    resolve([]);
                });
        });
    }

    async updateTimestamp() {
        if (!this.isInitialized) return;
        
        try {
            await this.db.ref('projects/default/lastUpdated').set(new Date().toISOString());
        } catch (error) {
            console.error('Error updating timestamp:', error);
        }
    }

    // Реaltime синхронизация
    setupRealtimeSync(onDataChange) {
        if (!this.isInitialized) return;

        this.db.ref('projects/default').on('value', (snapshot) => {
            const data = snapshot.val();
            if (data && onDataChange) {
                onDataChange(data.tasks || {}, data.columns || {});
            }
        });
    }
}

export default FirebaseService;