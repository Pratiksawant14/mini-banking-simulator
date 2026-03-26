from config import db
from datetime import datetime


def get_account(account_id: str):
    """Find and return one account document by account_id."""
    return db["accounts"].find_one({"account_id": account_id}, {"_id": 0})


def update_balance(account_id: str, new_balance: float):
    """Update the balance field of an account by account_id."""
    result = db["accounts"].update_one(
        {"account_id": account_id},
        {"$set": {"balance": new_balance}}
    )
    return result.modified_count > 0


def insert_log(log_entry: dict):
    """Insert a document into the schedules (log) collection."""
    log_entry.setdefault("timestamp", datetime.utcnow())
    return db["schedules"].insert_one(log_entry)


def insert_transaction(txn: dict):
    """Insert a document into the transactions collection."""
    txn.setdefault("start_time", datetime.utcnow())
    txn.setdefault("end_time", None)
    return db["transactions"].insert_one(txn)


def update_transaction_status(txn_id: str, status: str):
    """Update the status field of a transaction by transaction_id."""
    result = db["transactions"].update_one(
        {"transaction_id": txn_id},
        {"$set": {"status": status, "end_time": datetime.utcnow()}}
    )
    return result.modified_count > 0
