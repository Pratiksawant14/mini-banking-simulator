import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import db
from datetime import datetime
from models.db_models import get_transaction_timestamp


def acquire_lock(transaction_id: str, account_id: str, lock_type: str):
    """
    Attempts to acquire a Shared (S) or Exclusive (X) lock on an account.
    Applies 2PL compatibility rules with the Wound-Wait prevention layer.
    """
    from core.transaction_mgr import rollback_transaction  # Local import to avoid circular dependency
    locks_col = db["locks"]

    # Fetch all existing granted locks on this data item
    existing_locks = list(locks_col.find(
        {"data_item": account_id, "status": "granted"},
        {"_id": 0}
    ))

    conflicting_holders = []
    
    for lock in existing_locks:
        holder = lock["transaction_id"]
        held_type = lock["lock_type"]

        # ─── Self-check ───
        if holder == transaction_id:
            # Already holds X — covers both S and X requests
            if held_type == "X":
                return {"success": True, "status": "already_held"}
            # Holds S and requests S
            if held_type == "S" and lock_type == "S":
                return {"success": True, "status": "already_held"}
            # Holds S and requests X — check if upgrade is possible
            if held_type == "S" and lock_type == "X":
                other_holders = [l for l in existing_locks if l["transaction_id"] != transaction_id]
                if not other_holders:
                    # Upgrade lock from S → X
                    locks_col.update_one(
                        {"data_item": account_id, "transaction_id": transaction_id, "status": "granted"},
                        {"$set": {"lock_type": "X"}}
                    )
                    return {"success": True, "status": "upgraded_to_X"}
                else:
                    conflicting_holders.extend([l["transaction_id"] for l in other_holders])
            continue

        # ─── Conflict Check ───
        is_conflict = (held_type == "X") or (held_type == "S" and lock_type == "X")
        if is_conflict:
            conflicting_holders.append(holder)

    if not conflicting_holders:
        # No conflicts — grant the lock
        locks_col.insert_one({
            "transaction_id": transaction_id,
            "data_item": account_id,
            "lock_type": lock_type,
            "status": "granted",
            "timestamp": datetime.utcnow()
        })
        return {"success": True, "status": "granted"}

    # ─── Wound-Wait Prevention Layer ───
    # A = requester, B = holder
    ts_A = get_transaction_timestamp(transaction_id)
    
    can_wound_all = True
    victims = []

    for B_id in conflicting_holders:
        ts_B = get_transaction_timestamp(B_id)
        if not ts_A or not ts_B:
            can_wound_all = False
            break
        
        # If A started before B (A is older)
        if ts_A < ts_B:
            victims.append(B_id)
        else:
            # A is younger or same age — MUST WAIT
            can_wound_all = False
            break

    if can_wound_all and victims:
        # A wounds ALL younger holders
        for v_id in victims:
            rollback_transaction(v_id)
            release_all_locks(v_id)
        
        # Now grant it to A
        locks_col.insert_one({
            "transaction_id": transaction_id,
            "data_item": account_id,
            "lock_type": lock_type,
            "status": "granted",
            "timestamp": datetime.utcnow()
        })
        return {
            "success": True, 
            "status": "wounded_victim", 
            "victims": victims, 
            "granted_to": transaction_id
        }

    # Otherwise fall back to WAITING behavior
    _insert_waiting_lock(locks_col, transaction_id, account_id, lock_type)
    return {
        "success": False, 
        "status": "waiting", 
        "reason": f"Waiting for {', '.join(conflicting_holders)}"
    }


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


def preflight_check(locks_needed: list) -> dict:
    """
    Checks if the requested locks would be available without actually acquiring them.
    Used for Opt 4 — Pre-Execution Readiness Check.
    """
    locks_col = db["locks"]
    conflicts = []
    
    for req in locks_needed:
        acc_id = req["account_id"]
        req_type = req["lock_type"]
        
        # Find existing granted locks on this item
        granted = list(locks_col.find({"data_item": acc_id, "status": "granted"}))
        
        for g in granted:
            held_type = g["lock_type"]
            # Conflict if: X is held, or S is held and X is requested
            is_conflict = (held_type == "X") or (held_type == "S" and req_type == "X")
            
            if is_conflict:
                conflicts.append({
                    "account_id": acc_id,
                    "held_by": g["transaction_id"],
                    "lock_type": held_type,
                    "status": "granted"
                })
                break # Move to next requested lock
                
    return {
        "ready": len(conflicts) == 0,
        "conflicts": conflicts
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
