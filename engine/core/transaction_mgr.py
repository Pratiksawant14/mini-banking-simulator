import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.db_models import (
    get_account,
    update_balance,
    insert_log,
    insert_transaction,
    update_transaction_status
)
from config import db
from datetime import datetime


def begin_transaction(transaction_id: str, txn_type: str):
    """
    Starts a new transaction.
    Inserts a record into 'transactions' and logs a 'begin' entry.
    """
    insert_transaction({
        "transaction_id": transaction_id,
        "type": txn_type,
        "status": "active",
    })

    insert_log({
        "transaction_id": transaction_id,
        "operation": "begin",
        "data_item": None,
        "old_value": None,
        "new_value": None,
        "timestamp": datetime.utcnow()
    })

    return {"success": True, "transaction_id": transaction_id}


def read_value(transaction_id: str, account_id: str):
    """
    Reads the current balance of an account.
    Logs a 'read' operation into the schedules collection.
    """
    account = get_account(account_id)

    if not account:
        return {"success": False, "error": f"Account {account_id} not found"}

    balance = account["balance"]

    insert_log({
        "transaction_id": transaction_id,
        "operation": "read",
        "data_item": account_id,
        "old_value": None,
        "new_value": balance,
        "timestamp": datetime.utcnow()
    })

    return {"success": True, "account_id": account_id, "balance": balance}


def write_value(transaction_id: str, account_id: str, old_value: float, new_value: float):
    """
    Writes a new balance to an account.
    Logs the 'write' operation (with old and new values) for rollback support.
    """
    success = update_balance(account_id, new_value)

    if not success:
        return {"success": False, "error": f"Failed to update account {account_id}"}

    insert_log({
        "transaction_id": transaction_id,
        "operation": "write",
        "data_item": account_id,
        "old_value": old_value,
        "new_value": new_value,
        "timestamp": datetime.utcnow()
    })

    return {"success": True, "account_id": account_id, "new_balance": new_value}


def commit_transaction(transaction_id: str):
    """
    Commits a transaction — marks it 'committed' and logs a 'commit' entry.
    """
    update_transaction_status(transaction_id, "committed")

    insert_log({
        "transaction_id": transaction_id,
        "operation": "commit",
        "data_item": None,
        "old_value": None,
        "new_value": None,
        "timestamp": datetime.utcnow()
    })

    return {"success": True, "status": "committed"}


def rollback_transaction(transaction_id: str):
    """
    Rolls back a transaction by undoing all write operations using stored old_values.
    Updates status to 'aborted' and logs an 'abort' entry.
    """
    # Fetch all write logs for this transaction (in reverse chronological order)
    write_logs = list(
        db["schedules"].find(
            {"transaction_id": transaction_id, "operation": "write"},
            {"_id": 0}
        ).sort("timestamp", -1)
    )

    restored_accounts = []

    for log in write_logs:
        account_id = log["data_item"]
        old_value = log["old_value"]
        update_balance(account_id, old_value)
        restored_accounts.append({"account_id": account_id, "restored_balance": old_value})

    # Mark transaction as aborted
    update_transaction_status(transaction_id, "aborted")

    insert_log({
        "transaction_id": transaction_id,
        "operation": "abort",
        "data_item": None,
        "old_value": None,
        "new_value": None,
        "timestamp": datetime.utcnow()
    })

    return {
        "success": True,
        "status": "aborted",
        "restored_accounts": restored_accounts
    }
