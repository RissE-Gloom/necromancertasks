"use client"

import type React from "react"
import { Trash2 } from "lucide-react"

import type { Task } from "@/types/task"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { MoreVertical, ArrowRight, ArrowLeft, Check } from "lucide-react"

interface TaskCardProps {
  task: Task
  onUpdateStatus: (taskId: string, newStatus: Task["status"]) => void
  onDeleteTask: (taskId: string) => void
}

const priorityColors = {
  low: "bg-secondary text-secondary-foreground",
  medium: "bg-accent/20 text-accent-foreground",
  high: "bg-destructive/20 text-destructive-foreground",
}

const statusOptions = [
  { value: "todo", label: "To Do", icon: ArrowLeft },
  { value: "in-progress", label: "In Progress", icon: ArrowRight },
  { value: "done", label: "Done", icon: Check },
] as const

export function TaskCard({ task, onUpdateStatus, onDeleteTask }: TaskCardProps) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", task.id)
  }

  const handleStatusChange = (newStatus: Task["status"]) => {
    onUpdateStatus(task.id, newStatus)
  }

  const handleDelete = () => {
    onDeleteTask(task.id)
  }

  return (
    <Card
      className="p-4 cursor-move hover:shadow-md transition-shadow duration-200 bg-card border-border"
      draggable
      onDragStart={handleDragStart}
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-medium text-card-foreground text-sm leading-tight">{task.title}</h4>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="secondary" className={`text-xs ${priorityColors[task.priority]}`}>
              {task.priority}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 hover:bg-accent/50"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {statusOptions.map((option) => {
                  const Icon = option.icon
                  return (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() => handleStatusChange(option.value)}
                      disabled={task.status === option.value}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Icon className="h-3 w-3" />
                      Move to {option.label}
                    </DropdownMenuItem>
                  )
                })}
                <DropdownMenuItem
                  onClick={handleDelete}
                  className="flex items-center gap-2 text-sm text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete Task
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {task.description && <p className="text-sm text-muted leading-relaxed">{task.description}</p>}
      </div>
    </Card>
  )
}
