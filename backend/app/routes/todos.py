import json
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Todo
from ..redis_client import redis_client
from ..schemas import TodoCreate, TodoResponse, TodoUpdate

router = APIRouter(prefix="/todos", tags=["todos"])


@router.get("", response_model=List[TodoResponse])
def get_todos(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    return (
        db.query(Todo)
        .filter(Todo.user_id == current_user["user_id"])
        .order_by(Todo.id.asc())
        .all()
    )


@router.get("/{id}", response_model=TodoResponse)
def get_todo(
    id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    todo = (
        db.query(Todo)
        .filter(Todo.id == id, Todo.user_id == current_user["user_id"])
        .first()
    )
    if not todo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Todo with id {id} not found",
        )
    return todo


@router.post("", response_model=TodoResponse, status_code=status.HTTP_201_CREATED)
def create_todo(
    todo_in: TodoCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    todo = Todo(
        user_id=current_user["user_id"],
        title=todo_in.title,
        description=todo_in.description,
        completed=todo_in.completed,
    )
    db.add(todo)
    db.commit()
    db.refresh(todo)
    return todo


@router.put("/{id}", response_model=TodoResponse)
def update_todo(
    id: int,
    todo_in: TodoUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    todo = (
        db.query(Todo)
        .filter(Todo.id == id, Todo.user_id == current_user["user_id"])
        .first()
    )
    if not todo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Todo with id {id} not found",
        )

    update_data = todo_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(todo, field, value)

    db.commit()
    db.refresh(todo)
    return todo


@router.delete("/{id}")
def delete_todo(
    id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    todo = (
        db.query(Todo)
        .filter(Todo.id == id, Todo.user_id == current_user["user_id"])
        .first()
    )
    if not todo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Todo with id {id} not found",
        )

    # FastAPI does NOT delete the todo directly.
    # Enqueue a delete job to Redis for the Rust worker.
    job_payload = json.dumps({"todo_id": id})
    redis_client.rpush("todo_delete_queue", job_payload)

    return {"message": "Delete job enqueued successfully", "todo_id": id}
