"use client"

import { useState } from "react"
import { KanbanBoard } from "@/components/kanban-board"
import type { Task } from "@/types/task"

const initialTasks: Task[] = [
  {
    id: "1",
    title: "Design system review",
    description: "Review and update the design system components",
    status: "todo",
    priority: "high",
  },
  {
    id: "2",
    title: "API integration",
    description: "Integrate with the new authentication API",
    status: "todo",
    priority: "medium",
  },
  {
    id: "3",
    title: "User testing",
    description: "Conduct user testing sessions for the new features",
    status: "in-progress",
    priority: "high",
  },
  {
    id: "4",
    title: "Bug fixes",
    description: "Fix reported bugs from the last sprint",
    status: "in-progress",
    priority: "low",
  },
  {
    id: "5",
    title: "Documentation",
    description: "Update project documentation",
    status: "done",
    priority: "medium",
  },
]

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>(initialTasks)

  const updateTaskStatus = (taskId: string, newStatus: Task["status"]) => {
    setTasks(tasks.map((task) => (task.id === taskId ? { ...task, status: newStatus } : task)))
  }

  const addTask = (newTask: Omit<Task, "id">) => {
    const task: Task = {
      ...newTask,
      id: Date.now().toString(),
    }
    setTasks([...tasks, task])
  }

  const deleteTask = (taskId: string) => {
    setTasks(tasks.filter((task) => task.id !== taskId))
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-primary text-balance">Task Board</h1>
          <p className="text-muted mt-2">Organize and track your work efficiently</p>
        </header>

        <KanbanBoard
          tasks={tasks}
          onUpdateTaskStatus={updateTaskStatus}
          onAddTask={addTask}
          onDeleteTask={deleteTask}
        />
      </div>
    </main>
  )
}
