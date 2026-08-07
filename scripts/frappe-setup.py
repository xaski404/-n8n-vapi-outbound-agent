import frappe
from frappe.core.doctype.user.user import generate_keys
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

# 1) API keys for Administrator (idempotent: keeps api_key if present)
res = generate_keys("Administrator")
frappe.db.commit()
u = frappe.get_doc("User", "Administrator")
u.reload()
print("APIKEY=" + (u.api_key or ""))
print("APISECRET=" + (res.get("api_secret") or ""))

# 2) Ensure 'Campaign' Lead Source exists (mapper sets source='Campaign')
if not frappe.db.exists("Lead Source", "Campaign"):
    frappe.get_doc({"doctype": "Lead Source", "source_name": "Campaign"}).insert(
        ignore_permissions=True
    )
    frappe.db.commit()

# 3) Custom fields on Lead for the Vapi call outcome
create_custom_fields(
    {
        "Lead": [
            {"fieldname": "custom_call_outcome", "label": "Call Outcome", "fieldtype": "Data", "insert_after": "status"},
            {"fieldname": "custom_campaign", "label": "Campaign (raw)", "fieldtype": "Data", "insert_after": "custom_call_outcome"},
            {"fieldname": "custom_call_summary", "label": "Call Summary", "fieldtype": "Small Text", "insert_after": "custom_campaign"},
            {"fieldname": "custom_call_recording_url", "label": "Call Recording URL", "fieldtype": "Data", "insert_after": "custom_call_summary"},
            {"fieldname": "custom_vapi_call_id", "label": "Vapi Call ID", "fieldtype": "Data", "insert_after": "custom_call_recording_url"},
        ]
    },
    update=True,
)
frappe.db.commit()
print("SETUP_DONE")
