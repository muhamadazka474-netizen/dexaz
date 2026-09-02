from app.database.session import SessionLocal
from app.models.internal import User
from app.core.security import hash_password
from app.core.config import settings

db = SessionLocal()
user = db.query(User).filter(User.username == "admin").first()
if user:
    user.password_hash = hash_password(settings.dbx_admin_password)
    db.commit()
    print(f"Berhasil. Login pakai: admin / {settings.dbx_admin_password}")
else:
    print("User 'admin' tidak ditemukan.")
db.close()