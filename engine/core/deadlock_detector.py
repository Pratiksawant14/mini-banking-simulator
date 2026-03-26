import sys
import os
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


# ─── Cycle Detection (DFS) ────────────────────────────────────────────────────

def detect_cycle(graph: dict) -> dict:
    """
    Detects cycles in the Wait-For Graph using iterative DFS.

    Returns:
      { "cycle_found": True,  "cycle_path": ["T1", "T2", "T1"] }  — if cycle exists
      { "cycle_found": False }                                      — if no cycle
    """
    visited = set()       # Nodes fully processed
    rec_stack = set()     # Nodes in the current DFS path
    path_tracker = {}     # parent map to reconstruct cycle path

    def dfs(node, path):
        visited.add(node)
        rec_stack.add(node)
        path.append(node)

        for neighbour in graph.get(node, []):
            if neighbour not in visited:
                path_tracker[neighbour] = node
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
                return {"cycle_found": True, "cycle_path": cycle}

    return {"cycle_found": False}


# ─── Deadlock Resolution ──────────────────────────────────────────────────────

def resolve_deadlock(cycle_path: list) -> dict:
    """
    Selects a victim from the cycle and aborts it.

    Victim selection strategy:
      The last unique node in the cycle path (before the repeated closing node).
      This is the 'youngest' in the cycle based on position — simplest safe choice.

    Steps:
      1. Rollback the victim's writes (via transaction_mgr)
      2. Release all its locks (via lock_mgr)
    """
    # cycle_path looks like ["T1", "T2", "T1"] — victim is second-to-last unique
    unique_nodes = cycle_path[:-1]   # Strip the closing repeat
    victim = unique_nodes[-1]        # Last node in the cycle = youngest/victim

    # Abort and clean up the victim
    rollback_result = rollback_transaction(victim)
    lock_result = release_all_locks(victim)

    return {
        "success": True,
        "victim": victim,
        "action": "aborted and locks released",
        "rollback": rollback_result,
        "locks_released": lock_result["locks_removed"]
    }


# ─── Full Deadlock Check Orchestrator ────────────────────────────────────────

def run_deadlock_check() -> dict:
    """
    Full orchestration:
      1. Build the Wait-For Graph
      2. Run cycle detection
      3. If cycle found, resolve deadlock
      4. Return full diagnostic result
    """
    graph = build_wait_for_graph()
    cycle_result = detect_cycle(graph)

    response = {
        "wait_for_graph": graph,
        "cycle_detection": cycle_result,
        "resolution": None
    }

    if cycle_result["cycle_found"]:
        resolution = resolve_deadlock(cycle_result["cycle_path"])
        response["resolution"] = resolution

    return response
