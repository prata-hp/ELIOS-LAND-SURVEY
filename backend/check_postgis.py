import os
import sys
from dotenv import load_dotenv

load_dotenv()

try:
    import psycopg
except ImportError:
    print("psycopg is not installed.")
    sys.exit(1)

url = (
    os.getenv("DATABASE_URL")
    or os.getenv("DATABASE_URI")
    or os.getenv("POSTGRES_URL")
)

if not url:
    print("DATABASE_URL / DATABASE_URI / POSTGRES_URL is not configured.")
    sys.exit(2)

conn_url = url.replace("postgresql+psycopg://", "postgresql://").replace("postgresql+asyncpg://", "postgresql://")

print("Database URL detected.")

try:
    with psycopg.connect(conn_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT version();")
            print("\nPostgreSQL:")
            print(cur.fetchone()[0])

            cur.execute("SELECT PostGIS_Version();")
            print("\nPostGIS:")
            print(cur.fetchone()[0])

            cur.execute(
                """
                SELECT
                    to_regclass('public.cadastral_layers'),
                    to_regclass('public.old_parcels'),
                    to_regclass('public.new_parcels'),
                    to_regclass('public.parcel_comparisons');
                """
            )

            result = cur.fetchone()
            print("\nCadastral tables:")
            print("cadastral_layers      =", result[0])
            print("old_parcels           =", result[1])
            print("new_parcels           =", result[2])
            print("parcel_comparisons    =", result[3])

except Exception as exc:
    print("\nDatabase connection/check failed:")
    print(exc)
    sys.exit(3)
