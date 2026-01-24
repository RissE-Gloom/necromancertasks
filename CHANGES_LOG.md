# Лог изменений для переноса (Kanban Project)

Этот файл содержит все ключевые изменения, внесенные в черновой проект, для их последующего переноса в основную ветку.

---

## 1. JavaScript (`js/kanban.js`)

### Модель данных и инициализация
- В объект задачи (`task`) добавлено поле `parentId: string | null`.
- В конструктор `KanbanBoard` добавлены:
    - `this.expandedTasks = new Set()` — для отслеживания развернутых подзадач.
    - `this.labels = this.loadLabels()` — загрузка списка тайтлов.

### Управление метками (Тайтлами)
- `loadLabels()` / `saveLabels()`: Работа с `localStorage` (`kanban-labels`).
- `renderLabels()`: Отрисовка списка меток в модальном окне.
- `deleteLabel(index)`: Удаление метки с подтверждением.
- `updateLabelSelects()`: Синхронизация всех выпадающих списков меток в модальных окнах.

### Новые методы UI
- `setupColumnClickHandlers()`: Быстрое создание задач по клику на фон колонки.
- `toggleTaskExpand(taskId)`: Развертывание/свертывание подзадач.
- `createSubTaskElement(task)`: Рендер дочерних карточек.

### Изменения в существующей логике
- `getTasksByStatus(status)`: Теперь фильтрует, исключая подзадачи из основного списка колонки.
- `deleteTask(taskId)`: Добавлена рекурсия (удаляет подзадачи вместе с родителем) и `confirm()`.
- `updateTaskStatus(taskId, newStatus, newParentId)`: Интеграция `parentId` в процесс перемещения.

### Drag and Drop
- Полная переработка `handleDragOver` и `handleDrop`:
    - Добавлена логика "зоны вкладывания" (центр карточки).
    - Исправлена проблема множественного вкладывания (поиск родителя при наведении на подзадачи).
    - Визуальная индикация через класс `.drop-target-nest`.

---

## 2. Логика Бота (`bot/`)

### Интерактив и Подписки
- **`bot.js`**:
    - Добавлен слушатель кнопки `manage_notifications` ("Настроить уведы").
    - Регулярные выражения для обработки `sub_label_` и `sub_col_`.
- **`websocket.js`**:
    - Реализовано хранилище `subscriptions.json` для связей "Юзер-Метка-Колонка".
    - **Таргетинг**: Метод `#handleTaskMoved` теперь ищет подписчиков по паре `label`+`toStatus` и тегает их через `@username` в Telegram.
    - **Динамические меню**: Бот запрашивает актуальный список меток и колонок напрямую из веб-интерфейса через WebSocket.

---

## 3. CSS (`styles/main.css`)

### Система стилей
```css
:root {
  --primary: #6366f1;
  --primary-rgb: 99, 102, 241;
  --bg-secondary: #f1f5f9;
  --text-muted: #64748b;
  --border-color: #e2e8f0;
}
```

### Ключевые блоки:
- **Вложенность**: `.task-card.has-children`, `.subtasks-container`, `.task-card.subtask`.
- **Менеджер меток**: `.labels-list`, `.label-item`, `.input-with-button`.
- **UX**: `padding-bottom: 100px` для `.column-content` (зона для клика внизу).
- **Feedback**: `.drop-target-nest` (пунктирная рамка при вкладывании).

---

## 4. HTML (`index.html`)

### Новые элементы:
- Кнопка `<button id="manage-labels-btn">` в шапке.
- Модальное окно `<div id="labels-modal">` для управления списком тайтлов.
- Замена `<input type="text" name="label">` на `<select name="label">` во всех формах (создание и редактирование).

---

**Инструкция по переносу:** Сначала перенесите стили, затем обновите структуру HTML (особенно новые модалки и ID), и в последнюю очередь обновляйте JS-логику и файлы бота.
