from pymongo import MongoClient
from pymongo.errors import ConnectionFailure
import certifi

MONGO_URI = "mongodb+srv://Pratiksawant14:Lenovo%4014@clusterps.uui8x.mongodb.net/mbts?appName=ClusterPS"
DB_NAME = "mbts"

try:
    client = MongoClient(
        MONGO_URI,
        serverSelectionTimeoutMS=20000,
        tls=True,
        tlsAllowInvalidCertificates=True,
        tlsCAFile=certifi.where(),
        connect=False  # Avoid immediate connection overhead during Flask init
    )
    db = client[DB_NAME]
    # Test connection late (optional, will happen during first request)
    print("[OK] Python Engine: MongoDB Client Initialized (Lazy-connecting)")
except Exception as e:
    print(f"[ERROR] Python Engine: Initialization Failed - {e}")
    db = None
