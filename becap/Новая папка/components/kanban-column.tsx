"use client"

import type React from "react"
import { useState } from "react"
import { TaskCard } from "./task-card"
import type { Task } from "@/types/task"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Trash2, Edit2, Check, X } from "lucide-react"

interface KanbanColumnProps {
  title: string
  status: Task["status"]
  tasks: Task[]
  onUpdateTaskStatus: (taskId: string, newStatus: Task["status"]) => void
  onDeleteTask: (taskId: string) => void
  onDeleteColumn?: (status: Task["status"]) => void
  onUpdateTitle?: (status: Task["status"], newTitle: string) => void
  canDelete?: boolean
}

export function KanbanColumn({
  title,
  status,
  tasks,
  onUpdateTaskStatus,
  onDeleteTask,
  onDeleteColumn,
  onUpdateTitle,
  canDelete = false,
}: KanbanColumnProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(title)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const taskId = e.dataTransfer.getData("text/plain")
    onUpdateTaskStatus(taskId, status)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDeleteColumn = () => {
    if (onDeleteColumn) {
      onDeleteColumn(status)
    }
  }

  const handleStartEdit = () => {
    setIsEditing(true)
    setEditTitle(title)
  }

  const handleSaveEdit = () => {
    if (onUpdateTitle && editTitle.trim()) {
      onUpdateTitle(status, editTitle.trim())
      setIsEditing(false)
    }
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditTitle(title)
  }

  return (
    <div
      className="bg-secondary rounded-lg p-4 min-h-[400px] md:min-h-[500px] w-full min-w-[280px]"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className="flex items-center justify-between mb-4">
        {isEditing ? (
          <div className="flex items-center gap-2 flex-1">
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveEdit()
                if (e.key === "Escape") handleCancelEdit()
              }}
              className="h-8 text-sm font-semibold"
              autoFocus
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 hover:bg-green-500/20 hover:text-green-600"
              onClick={handleSaveEdit}
            >
              <Check className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 hover:bg-red-500/20 hover:text-red-600"
              onClick={handleCancelEdit}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1">
            <h3 className="font-semibold text-primary">{title}</h3>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-accent/20" onClick={handleStartEdit}>
              <Edit2 className="h-3 w-3" />
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted bg-background px-2 py-1 rounded-full">{tasks.length}</span>
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 hover:bg-destructive/20 hover:text-destructive"
              onClick={handleDeleteColumn}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onUpdateStatus={onUpdateTaskStatus} onDeleteTask={onDeleteTask} />
        ))}
      </div>
    </div>
  )
}
