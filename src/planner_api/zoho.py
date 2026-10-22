"""Zoho Inventory API adapter: DISABLED STUB (RULEBOOK v1.1 amendment 2).

The app never submits orders anywhere. POs are files procurement enters in Zoho by hand.
TODO: if Freshroots later approves live sync, specify it in RULEBOOK.md first (Section 16),
then implement create_purchase_order() against the Zoho Inventory API here.
"""
from .settings import get_settings


class ZohoSyncDisabled(RuntimeError):
    pass


def create_purchase_order(po: dict) -> str:
    if not get_settings().zoho_sync_enabled:
        raise ZohoSyncDisabled("ZOHO_SYNC_ENABLED=false: Zoho API calls are not allowed")
    raise NotImplementedError("TODO: Zoho Inventory sync is not specified in RULEBOOK.md")
