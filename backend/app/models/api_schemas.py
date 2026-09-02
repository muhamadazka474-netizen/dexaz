from typing import Optional, Any
from pydantic import BaseModel, Field


# --- Auth ---
class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str


# --- Database connections ---
class ConnectionCreate(BaseModel):
    name: str
    db_type: str = Field(default="postgresql")
    host: Optional[str] = None
    port: Optional[int] = None
    database_name: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    ssl_mode: Optional[str] = "prefer"
    sqlite_path: Optional[str] = None


class ConnectionUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    database_name: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None  # only re-encrypted if provided
    ssl_mode: Optional[str] = None
    sqlite_path: Optional[str] = None
    is_favorite: Optional[bool] = None


class ConnectionOut(BaseModel):
    id: str
    name: str
    db_type: str
    host: Optional[str] = None
    port: Optional[int] = None
    database_name: Optional[str] = None
    username: Optional[str] = None
    ssl_mode: Optional[str] = None
    sqlite_path: Optional[str] = None
    is_favorite: bool = False
    status: Optional[str] = None  # populated on demand, not stored

    class Config:
        from_attributes = True


# --- Query execution ---
class QueryExecuteRequest(BaseModel):
    connection_id: str
    sql: str
    confirm_destructive: bool = False
    database: Optional[str] = None


class QueryExecuteResponse(BaseModel):
    success: bool
    statement_type: str
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int
    duration_ms: int
    error: Optional[str] = None
    requires_confirmation: bool = False
    warning: Optional[str] = None


# --- Table data ---
class TableDataFilter(BaseModel):
    column: str
    op: str  # =, !=, >, <, >=, <=, contains, starts_with, ends_with
    value: Any


class RowMutationRequest(BaseModel):
    values: dict[str, Any]


class RowUpdateRequest(BaseModel):
    pk: dict[str, Any]
    values: dict[str, Any]


class RowDeleteRequest(BaseModel):
    pk: dict[str, Any]


# --- ERD relationships ---
class RelationshipCreateRequest(BaseModel):
    schema_name: str
    table: str
    column: str
    ref_table: str
    ref_column: str
    database: Optional[str] = None


class RelationshipDeleteRequest(BaseModel):
    schema_name: str
    table: str
    constraint_name: str
    database: Optional[str] = None
