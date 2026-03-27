import sys
import os
from datetime import datetime
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import db
from core.transaction_mgr import rollback_transaction
from core.lock_mgr import release_all_locks


# ─── Wait-For Graph Builder ───────────────────────────────────────────────────

def build_wait_for_graph() -> dict:
    """
    Builds a Wait-For Graph (WFG) from the current locks collection.

    Algorithm:
      For each lock with status='waiting' on data_item D by transaction W:
        Find all transactions that currently hold a 'granted' lock on D.
        For each such holder H (where H != W):
          Add edge W -> H  (meaning: W is waiting for H to release D)

    Returns a dict like: { "T1": ["T2"], "T2": ["T3"] }
    """
    locks_col = db["locks"]
    all_locks = list(locks_col.find({}, {"_id": 0}))

    graph = {}

    waiting_locks = [l for l in all_locks if l["status"] == "waiting"]
    granted_locks = [l for l in all_locks if l["status"] == "granted"]

    for waiter in waiting_locks:
        waiter_txn = waiter["transaction_id"]
        data_item = waiter["data_item"]

        # Find all granted holders on the same data item
        holders = [
            l["transaction_id"]
            for l in granted_locks
            if l["data_item"] == data_item and l["transaction_id"] != waiter_txn
        ]

        if holders:
            if waiter_txn not in graph:
                graph[waiter_txn] = []
            for h in holders:
                if h not in graph[waiter_txn]:
                    graph[waiter_txn].append(h)

    return graph


# ─── Cycle Detection (DFS + Fast Path) ────────────────────────────────────────

def detect_length2_cycle(graph: dict) -> dict:
    """
    O(E) fast scan for direct two-transaction cycles (T1 -> T2 -> T1).
    Catches the most common deadlock pattern instantly.
    """
    for u in graph:
        for v in graph.get(u, []):
            if v in graph and u in graph.get(v, []):
                # Found a cycle T_i -> T_j -> T_i
                return {
                    "cycle_found": True,
                    "cycle_path": [u, v, u],
                    "method": "fast_path"
                }

    return {"cycle_found": False}


def detect_cycle(graph: dict) -> dict:
    """
    Detects cycles in the Wait-For Graph.
    First tries the O(E) length-2 fast path, then falls back to full iterative DFS.
    """
    # ─── 1. Call Fast Path first ───
    fast_result = detect_length2_cycle(graph)
    if fast_result["cycle_found"]:
        return fast_result

    # ─── 2. Fall back to Full DFS ───
    visited = set()       # Nodes fully processed
    rec_stack = set()     # Nodes in the current DFS path

    def dfs(node, path):
        visited.add(node)
        rec_stack.add(node)
        path.append(node)

        for neighbour in graph.get(node, []):
            if neighbour not in visited:
                result = dfs(neighbour, path)
                if result is not None:
                    return result
            elif neighbour in rec_stack:
                # Cycle detected — reconstruct the cycle path
                cycle_start = neighbour
                cycle = []
                idx = len(path) - 1
                while path[idx] != cycle_start:
                    cycle.append(path[idx])
                    idx -= 1
                cycle.append(cycle_start)
                cycle.reverse()
                cycle.append(cycle_start)  # Close the loop
                return cycle

        path.pop()
        rec_stack.discard(node)
        return None

    for node in list(graph.keys()):
        if node not in visited:
            cycle = dfs(node, [])
            if cycle:
                return {
                    "cycle_found": True,
                    "cycle_path": cycle,
                    "method": "full_dfs"
                }

    return {"cycle_found": False, "method": "full_dfs"}


# ─── Victim Selection Strategies ─────────────────────────────────────────────

def select_victim_least_work(cycle_path: list) -> str:
    """
    Selects the victim with the fewest 'write' operations in the schedules log.
    Minimize the cost of undo/rollback.
    """
    unique_nodes = list(set(cycle_path[:-1]))
    counts = {}
    
    for txn_id in unique_nodes:
        # Count write operations in schedules collection
        write_count = db["schedules"].count_documents({"transaction_id": txn_id, "operation": "write"})
        counts[txn_id] = write_count

    # Find minimum write count
    min_writes = min(counts.values())
    candidates = [t for t in unique_nodes if counts[t] == min_writes]
    
    # Tie-break: pick the one that appears latest in the cycle (youngest by position)
    if len(candidates) > 1:
        # Filter cycle_path to only include candidates and pick the last one
        for node in reversed(cycle_path[:-1]):
            if node in candidates:
                return node
    return candidates[0]


def select_victim_most_locks(cycle_path: list) -> str:
    """
    Selects the victim holding the MOST granted locks.
    Maximize the amount of resources freed for other transactions.
    """
    unique_nodes = list(set(cycle_path[:-1]))
    counts = {}
    
    for txn_id in unique_nodes:
        # Count granted locks in locks collection
        lock_count = db["locks"].count_documents({"transaction_id": txn_id, "status": "granted"})
        counts[txn_id] = lock_count

    # Find maximum lock count
    max_locks = max(counts.values())
    candidates = [t for t in unique_nodes if counts[t] == max_locks]
    
    # Tie-break: pick the one that appears latest in the cycle (youngest by position)
    if len(candidates) > 1:
        for node in reversed(cycle_path[:-1]):
            if node in candidates:
                return node
    return candidates[0]


# ─── Deadlock Resolution ──────────────────────────────────────────────────────

def resolve_deadlock(cycle_path: list, strategy: str = "youngest") -> dict:
    """
    Selects a victim from the cycle using the specified strategy and aborts it.
    """
    if strategy == "least_work":
        victim = select_victim_least_work(cycle_path)
    elif strategy == "most_locks":
        victim = select_victim_most_locks(cycle_path)
    else:
        # Default: youngest-first (last in cycle path)
        unique_nodes = cycle_path[:-1]
        victim = unique_nodes[-1]

    # Abort and clean up the victim
    rollback_result = rollback_transaction(victim)
    lock_result = release_all_locks(victim)

    return {
        "success": True,
        "victim": victim,
        "strategy_used": strategy,
        "action": "aborted and locks released",
        "rollback": rollback_result,
        "locks_released": lock_result["locks_removed"]
    }


def check_timeout_triggers(threshold_sec: int = 3) -> dict:
    """
    Checks if any transaction has been waiting for a lock longer than threshold_sec.
    Used for intelligent auto-detection.
    """
    now = datetime.utcnow()
    waiting_locks = list(db["locks"].find({"status": "waiting"}))
    
    stale_locks = [
        {"transaction_id": l["transaction_id"], "account_id": l["data_item"], "wait_time": (now - l["timestamp"]).total_seconds()}
        for l in waiting_locks if l.get("timestamp") and (now - l["timestamp"]).total_seconds() > threshold_sec
    ]

    return {
        "triggered": len(stale_locks) > 0,
        "reason": "lock timeout exceeded" if stale_locks else None,
        "stale_locks": stale_locks
    }


# ─── Full Deadlock Check Orchestrator ────────────────────────────────────────

def run_deadlock_check(strategy: str = "youngest") -> dict:
    """
    Full orchestration with strategy-based victim selection.
    """
    graph = build_wait_for_graph()
    cycle_result = detect_cycle(graph)

    response = {
        "wait_for_graph": graph,
        "cycle_detection": cycle_result,
        "resolution": None
    }

    if cycle_result["cycle_found"]:
        resolution = resolve_deadlock(cycle_result["cycle_path"], strategy=strategy)
        response["resolution"] = resolution

    return response
