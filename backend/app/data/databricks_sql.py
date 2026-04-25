"""Databricks SQL Warehouse — used by the retriever agent."""
import os
from contextlib import contextmanager
from typing import Iterator

from databricks import sql
from databricks.sql.client import Connection


@contextmanager
def connect() -> Iterator[Connection]:
    host = os.environ["DATABRICKS_HOST"].replace("https://", "")
    with sql.connect(
        server_hostname=host,
        http_path=os.environ["DATABRICKS_HTTP_PATH"],
        access_token=os.environ["DATABRICKS_TOKEN"],
    ) as conn:
        yield conn


def query(sql_text: str, params: dict | None = None) -> list[dict]:
    """Execute a SQL query and return rows as a list of dicts."""
    with connect() as conn:
        with conn.cursor() as cur:
            if params:
                cur.execute(sql_text, params)
            else:
                cur.execute(sql_text)
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
