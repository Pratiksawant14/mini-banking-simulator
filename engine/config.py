from pymongo import MongoClient
from pymongo.errors import ConnectionFailure

MONGO_URI = "mongodb+srv://Pratiksawant14:Lenovo%4014@clusterps.uui8x.mongodb.net/mbts?appName=ClusterPS"
DB_NAME = "mbts"

try:
    client = MongoClient(
        MONGO_URI,
        serverSelectionTimeoutMS=10000,
        tls=True,
        tlsAllowInvalidCertificates=True
    )
    # Ping to confirm connection
    client.admin.command("ping")
    db = client[DB_NAME]
    print("[OK] Python Engine: MongoDB Connected")
except ConnectionFailure as e:
    print(f"[ERROR] Python Engine: MongoDB Connection Failed - {e}")
    db = None
except Exception as e:
    print(f"[ERROR] Python Engine: Unexpected error - {e}")
    db = None
