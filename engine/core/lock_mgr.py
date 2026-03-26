import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import db
from datetime import datetime


# ─── Lock Compatibility Matrix ────────────────────────────────────────────────
#
#  Existing Lock  | New S Request | New X Request
#  ───────────────────────────────────────────────
#  None           |  ✅ Grant     |  ✅ Grant
#  S (same txn)   |  ✅ Grant     |  ✅ Grant
#  S (diff txn)   |  ✅ Grant     |  ❌ Wait
#  X (same txn)   |  ✅ Grant     |  ✅ Grant
#  X (diff txn)   |  ❌ Wait      |  ❌ Wait
# ─────────────────────────────────────────────────


def acquire_lock(transaction_id: str, account_id: str, lock_type: str):
    """
    Attempts to acquire a Shared (S) or Exclusive (X) lock on an account.
    Applies 2PL compatibility rules.
    """
    locks_col = db["locks"]

    # Fetch all existing granted locks on this data item
    existing_locks = list(locks_col.find(
        {"data_item": account_id, "status": "granted"},
        {"_id": 0}
    ))

    for lock in existing_locks:
        holder = lock["transaction_id"]
        held_type = lock["lock_type"]

        # Same transaction already holds this or a compatible lock
        if holder == transaction_id:
            # Already holds X — covers both S and X requests
            if held_type == "X":
                return {"success": True, "status": "already_held"}
            # Holds S and requests S
            if held_type == "S" and lock_type == "S":
                return {"success": True, "status": "already_held"}
            # Holds S and requests X — only allowed if no other transactions hold S
            if held_type == "S" and lock_type == "X":
                other_holders = [l for l in existing_locks if l["transaction_id"] != transaction_id]
                if not other_holders:
                    # Upgrade lock from S → X
                    locks_col.update_one(
                        {"data_item": account_id, "transaction_id": transaction_id, "status": "granted"},
                        {"$set": {"lock_type": "X"}}
                    )
                    return {"success": True, "status": "upgraded_to_X"}
                # Other txns hold S — cannot upgrade, must wait
                _insert_waiting_lock(locks_col, transaction_id, account_id, lock_type)
                return {"success": False, "status": "waiting", "reason": "Lock upgrade blocked by other S-holders"}
            continue

        # Different transaction holds the lock — apply conflict rules
        if held_type == "X":
            # X held by another txn — BLOCKS both S and X
            _insert_waiting_lock(locks_col, transaction_id, account_id, lock_type)
            return {"success": False, "status": "waiting", "reason": f"X lock held by {holder}"}

        if held_type == "S" and lock_type == "X":
            # S held by another txn — BLOCKS X request only
            _insert_waiting_lock(locks_col, transaction_id, account_id, lock_type)
            return {"success": False, "status": "waiting", "reason": f"S lock held by {holder}"}

    # No conflicts — grant the lock
    locks_col.insert_one({
        "transaction_id": transaction_id,
        "data_item": account_id,
        "lock_type": lock_type,
        "status": "granted",
        "timestamp": datetime.utcnow()
    })
    return {"success": True, "status": "granted"}


def _insert_waiting_lock(locks_col, transaction_id: str, account_id: str, lock_type: str):
    """Internal helper — inserts a waiting lock entry."""
    locks_col.insert_one({
        "transaction_id": transaction_id,
        "data_item": account_id,
        "lock_type": lock_type,
        "status": "waiting",
        "timestamp": datetime.utcnow()
    })


def release_lock(transaction_id: str, account_id: str):
    """
    Releases a specific lock held by a transaction on one account.
    """
    result = db["locks"].delete_many({
        "transaction_id": transaction_id,
        "data_item": account_id
    })
    return {
        "success": True,
        "released": account_id,
        "locks_removed": result.deleted_count
    }


def release_all_locks(transaction_id: str):
    """
    Releases ALL locks held by a transaction (called on COMMIT or ABORT).
    """
    result = db["locks"].delete_many({"transaction_id": transaction_id})
    return {
        "success": True,
        "transaction_id": transaction_id,
        "locks_removed": result.deleted_count
    }


def get_lock_table():
    """
    Returns all entries in the locks collection — the current lock table state.
    """
    locks = list(db["locks"].find({}, {"_id": 0}))
    # Convert datetime objects to ISO strings for JSON serialization
    for lock in locks:
        if "timestamp" in lock:
            lock["timestamp"] = lock["timestamp"].isoformat()
    return {"success": True, "locks": locks}
