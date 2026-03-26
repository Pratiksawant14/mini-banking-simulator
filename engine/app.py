from flask import Flask, jsonify, request
from flask_cors import CORS
from config import db  # Triggers MongoDB connection on startup

from core.transaction_mgr import (
    begin_transaction,
    read_value,
    write_value,
    commit_transaction,
    rollback_transaction
)
from core.lock_mgr import (
    acquire_lock,
    release_lock,
    release_all_locks,
    get_lock_table
)
from core.deadlock_detector import (
    build_wait_for_graph,
    run_deadlock_check
)

app = Flask(__name__)
CORS(app)


# ─── Health Check ────────────────────────────────────────────────────────────

@app.route("/ping", methods=["GET"])
def ping():
    return jsonify({"message": "Python engine is alive"}), 200


# ─── Transaction Routes ───────────────────────────────────────────────────────

@app.route("/transaction/begin", methods=["POST"])
def begin():
    body = request.get_json()
    transaction_id = body.get("transaction_id")
    txn_type = body.get("txn_type", "generic")
    if not transaction_id:
        return jsonify({"success": False, "error": "transaction_id is required"}), 400
    return jsonify(begin_transaction(transaction_id, txn_type)), 200


@app.route("/transaction/read", methods=["POST"])
def read():
    body = request.get_json()
    transaction_id = body.get("transaction_id")
    account_id = body.get("account_id")
    if not transaction_id or not account_id:
        return jsonify({"success": False, "error": "transaction_id and account_id are required"}), 400
    result = read_value(transaction_id, account_id)
    return jsonify(result), 200 if result["success"] else 404


@app.route("/transaction/write", methods=["POST"])
def write():
    body = request.get_json()
    transaction_id = body.get("transaction_id")
    account_id = body.get("account_id")
    old_value = body.get("old_value")
    new_value = body.get("new_value")
    if None in [transaction_id, account_id, old_value, new_value]:
        return jsonify({"success": False, "error": "All fields are required"}), 400
    result = write_value(transaction_id, account_id, old_value, new_value)
    return jsonify(result), 200 if result["success"] else 500


@app.route("/transaction/commit", methods=["POST"])
def commit():
    body = request.get_json()
    transaction_id = body.get("transaction_id")
    if not transaction_id:
        return jsonify({"success": False, "error": "transaction_id is required"}), 400
    return jsonify(commit_transaction(transaction_id)), 200


@app.route("/transaction/rollback", methods=["POST"])
def rollback():
    body = request.get_json()
    transaction_id = body.get("transaction_id")
    if not transaction_id:
        return jsonify({"success": False, "error": "transaction_id is required"}), 400
    return jsonify(rollback_transaction(transaction_id)), 200


# ─── Lock Routes ─────────────────────────────────────────────────────────────

@app.route("/lock/acquire", methods=["POST"])
def lock_acquire():
    body = request.get_json()
    transaction_id = body.get("transaction_id")
    account_id = body.get("account_id")
    lock_type = body.get("lock_type")
    if not all([transaction_id, account_id, lock_type]):
        return jsonify({"success": False, "error": "transaction_id, account_id and lock_type are required"}), 400
    if lock_type not in ("S", "X"):
        return jsonify({"success": False, "error": "lock_type must be 'S' or 'X'"}), 400
    return jsonify(acquire_lock(transaction_id, account_id, lock_type)), 200


@app.route("/lock/release", methods=["POST"])
def lock_release():
    body = request.get_json()
    transaction_id = body.get("transaction_id")
    account_id = body.get("account_id")
    if not all([transaction_id, account_id]):
        return jsonify({"success": False, "error": "transaction_id and account_id are required"}), 400
    return jsonify(release_lock(transaction_id, account_id)), 200


@app.route("/lock/release-all", methods=["POST"])
def lock_release_all():
    body = request.get_json()
    transaction_id = body.get("transaction_id")
    if not transaction_id:
        return jsonify({"success": False, "error": "transaction_id is required"}), 400
    return jsonify(release_all_locks(transaction_id)), 200


@app.route("/lock/table", methods=["GET"])
def lock_table():
    return jsonify(get_lock_table()), 200


# ─── Deadlock Detection Routes ────────────────────────────────────────────────

@app.route("/deadlock/graph", methods=["GET"])
def deadlock_graph():
    """Returns the current Wait-For Graph built from the live lock table."""
    graph = build_wait_for_graph()
    return jsonify({"success": True, "wait_for_graph": graph}), 200


@app.route("/deadlock/check", methods=["GET"])
def deadlock_check():
    """Runs a full deadlock check: builds WFG, detects cycles, resolves if found."""
    result = run_deadlock_check()
    return jsonify(result), 200


@app.route("/schedules", methods=["GET"])
def get_schedules():
    """Returns all schedule log entries sorted by timestamp ascending."""
    from datetime import datetime
    entries = list(db["schedules"].find({}, {"_id": 0}).sort("timestamp", 1))
    for e in entries:
        if "timestamp" in e and isinstance(e["timestamp"], datetime):
            e["timestamp"] = e["timestamp"].isoformat()
    return jsonify({"success": True, "schedules": entries}), 200


# ─── System Reset ────────────────────────────────────────────────────────────

@app.route("/reset", methods=["POST"])
def reset_system():
    """
    Full system reset:
      - Clears locks, schedules, transactions collections
      - Restores all 4 account balances to original seed values
    """
    db["locks"].delete_many({})
    db["schedules"].delete_many({})
    db["transactions"].delete_many({})

    seed_balances = {
        "ACC1001": 5000,
        "ACC1002": 3000,
        "ACC1003": 7000,
        "ACC1004": 2000,
    }
    for acc_id, balance in seed_balances.items():
        db["accounts"].update_one(
            {"account_id": acc_id},
            {"$set": {"balance": balance, "status": "active"}}
        )

    return jsonify({
        "success": True,
        "message": "System reset complete",
        "collections_cleared": ["locks", "schedules", "transactions"],
        "balances_restored": seed_balances
    }), 200


# ─── Entry Point ─────────────────────────────────────────────────────────────



if __name__ == "__main__":
    print("🚀 Python Flask Engine starting on port 6000...")
    app.run(host="0.0.0.0", port=6000, debug=True)
