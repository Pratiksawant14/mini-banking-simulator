# Mini Banking Transaction Simulator

This project is a web-based application simulating real bank transactions.
It demonstrates core DBMS concepts like ACID properties and transaction scheduling.
It features a Node.js API layer bridging the frontend dashboard and the core DBMS logic.
The backend transaction engine is built in Python to enforce 2-Phase Locking securely.
Additionally, it actively detects deadlocks using wait-for graphs algorithms and persists transactions in MongoDB.
