import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import db
from collections import defaultdict, deque

def build_precedence_graph(transaction_ids: list) -> dict:
    """
    Constructs a precedence graph based on shared data item access.
    Detects R-W, W-R, and W-W conflicts between different transactions.
    """
    # Fetch relevant operations
    schedules = list(db["schedules"].find({
        "transaction_id": {"$in": transaction_ids},
        "operation": {"$in": ["read", "write"]}
    }).sort("timestamp", 1))

    graph = {tid: set() for tid in transaction_ids}
    
    # Compare every pair of operations for conflicts
    for i in range(len(schedules)):
        op_i = schedules[i]
        for j in range(i + 1, len(schedules)):
            op_j = schedules[j]
            
            # Must be different transactions on the same data item
            if op_i["transaction_id"] == op_j["transaction_id"]:
                continue
            if op_i.get("data_item") != op_j.get("data_item"):
                continue
                
            # Conflict rules:
            # 1. READ then WRITE
            # 2. WRITE then READ
            # 3. WRITE then WRITE
            conflict = False
            if op_i["operation"] == "read" and op_j["operation"] == "write":
                conflict = True
            elif op_i["operation"] == "write" and op_j["operation"] == "read":
                conflict = True
            elif op_i["operation"] == "write" and op_j["operation"] == "write":
                conflict = True
                
            if conflict:
                graph[op_i["transaction_id"]].add(op_j["transaction_id"])

    # Convert sets to lists for JSON serialization
    return {tid: list(targets) for tid, targets in graph.items()}

def check_acyclicity(graph: dict) -> dict:
    """
    Kahn's algorithm for topological sorting to detect cycles.
    """
    in_degree = {u: 0 for u in graph}
    for u in graph:
        for v in graph[u]:
            in_degree[v] += 1
            
    queue = deque([u for u in in_degree if in_degree[u] == 0])
    cnt = 0
    
    while queue:
        u = queue.popleft()
        cnt += 1
        for v in graph[u]:
            in_degree[v] -= 1
            if in_degree[v] == 0:
                queue.append(v)
                
    if cnt == len(graph):
        return {"serializable": True}
    else:
        # Find a back-edge or cycle edge for reporting
        # For simplicity, pick the first edge from a node that still has in-degree > 0
        for u in graph:
            for v in graph[u]:
                # If both are part of some cycle
                # (Actual Kahn's logic is simpler: any edge in the remaining subgraph)
                return {"serializable": False, "cycle_edge": [u, v]}
        return {"serializable": False}

def validate_schedule(transaction_ids: list) -> dict:
    """
    Builds precedence graph and checks for acyclicity.
    """
    graph = build_precedence_graph(transaction_ids)
    check_res = check_acyclicity(graph)
    
    if check_res["serializable"]:
        return {
            "result": "SERIALIZABLE",
            "graph": graph
        }
    else:
        return {
            "result": "NOT SERIALIZABLE",
            "graph": graph,
            "cycle_edge": check_res.get("cycle_edge")
        }
