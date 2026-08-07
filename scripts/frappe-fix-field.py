import frappe

# Recording URLs from Vapi are long presigned links (>140). Data caps at 140,
# so widen the field to Small Text (TEXT column, effectively unlimited).
name = "Lead-custom_call_recording_url"
cf = frappe.get_doc("Custom Field", name)
cf.fieldtype = "Small Text"
cf.save(ignore_permissions=True)
frappe.db.commit()
print("FIELD_FIXED", cf.fieldtype)
