"use client"

import { useState } from "react"
import { KanbanColumn } from "./kanban-column"
import { AddTaskDialog } from "./add-task-dialog"
import type { Task } from "@/types/task"
import { Button } from "@/components/ui/button"
import { Plus, Columns } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

interface Column {
  id: string
  title: string
  status: Task["status"]
}

interface KanbanBoardProps {
  tasks: Task[]
  onUpdateTaskStatus: (taskId: string, newStatus: Task["status"]) => void
  onAddTask: (task: Omit<Task, "id">) => void
  onDeleteTask: (taskId: string) => void
}

const defaultColumns: Column[] = [
  { id: "todo", title: "To Do", status: "todo" as const },
  { id: "in-progress", title: "In Progress", status: "in-progress" as const },
  { id: "done", title: "Done", status: "done" as const },
]

export function KanbanBoard({ tasks, onUpdateTaskStatus, onAddTask, onDeleteTask }: KanbanBoardProps) {
  const [isAddTaskOpen, setIsAddTaskOpen] = useState(false)
  const [columns, setColumns] = useState<Column[]>(defaultColumns)
  const [isAddColumnOpen, setIsAddColumnOpen] = useState(false)
  const [newColumnTitle, setNewColumnTitle] = useState("")

  const getTasksByStatus = (status: Task["status"]) => {
    return tasks.filter((task) => task.status === status)
  }

  const handleAddColumn = () => {
    if (newColumnTitle.trim()) {
      const newStatus = newColumnTitle.toLowerCase().replace(/\s+/g, "-") as Task["status"]
      const newColumn: Column = {
        id: newStatus,
        title: newColumnTitle.trim(),
        status: newStatus,
      }
      setColumns([...columns, newColumn])
      setNewColumnTitle("")
      setIsAddColumnOpen(false)
    }
  }

  const handleDeleteColumn = (status: Task["status"]) => {
    // Move tasks from deleted column to first available column
    const tasksInColumn = getTasksByStatus(status)
    if (tasksInColumn.length > 0 && columns.length > 1) {
      const remainingColumns = columns.filter((col) => col.status !== status)
      const targetStatus = remainingColumns[0].status
      tasksInColumn.forEach((task) => {
        onUpdateTaskStatus(task.id, targetStatus)
      })
    }

    // Only prevent deletion if it's the last column
    if (columns.length > 1) {
      setColumns(columns.filter((col) => col.status !== status))
    }
  }

  const handleUpdateColumnTitle = (status: Task["status"], newTitle: string) => {
    setColumns(columns.map((col) => (col.status === status ? { ...col, title: newTitle } : col)))
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4">
      <div className="flex justify-end gap-2">
        <Dialog open={isAddColumnOpen} onOpenChange={setIsAddColumnOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="border-accent/20 hover:bg-accent/10 bg-transparent">
              <Columns className="w-4 h-4 mr-2" />
              Add Column
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Column</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder="Column title"
                value={newColumnTitle}
                onChange={(e) => setNewColumnTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddColumn()}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsAddColumnOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddColumn} disabled={!newColumnTitle.trim()}>
                  Add Column
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Button onClick={() => setIsAddTaskOpen(true)} className="bg-accent hover:bg-accent/90 text-accent-foreground">
          <Plus className="w-4 h-4 mr-2" />
          Add Task
        </Button>
      </div>

      <div
        className="flex flex-col md:flex md:flex-row gap-6 overflow-x-auto justify-center md:justify-start"
        style={{
          minWidth: "fit-content",
        }}
      >
        {columns.map((column) => (
          <div key={column.id} className="flex-shrink-0 w-full md:w-72">
            <KanbanColumn
              title={column.title}
              status={column.status}
              tasks={getTasksByStatus(column.status)}
              onUpdateTaskStatus={onUpdateTaskStatus}
              onDeleteTask={onDeleteTask}
              onDeleteColumn={handleDeleteColumn}
              onUpdateTitle={handleUpdateColumnTitle}
              canDelete={columns.length > 1}
            />
          </div>
        ))}
      </div>

      <AddTaskDialog open={isAddTaskOpen} onOpenChange={setIsAddTaskOpen} onAddTask={onAddTask} />
    </div>
  )
}
