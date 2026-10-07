/**
 * GNW Zero-Trust GCP Infrastructure
 * sec(infra): Least-privilege IAM roles and service accounts
 */

# Service Account for GNW Agent
resource "google_service_account" "gnw_agent_sa" {
  account_id   = "${var.project_prefix}-gnw-agent-sa"
  display_name = "GNW Governed Agent Service Account"
  description  = "Service account for GNW governed agent workloads with least-privilege access"
}

# Service Account for Vertex AI
resource "google_service_account" "gnw_vertex_sa" {
  account_id   = "${var.project_prefix}-gnw-vertex-sa"
  display_name = "GNW Vertex AI Service Account"
  description  = "Service account for Vertex AI workloads"
}

# Custom role for GNW Agent - minimal permissions
resource "google_project_iam_custom_role" "gnw_agent_role" {
  role_id     = "${var.project_prefix}.gnwAgentRole"
  title       = "GNW Agent Role"
  description = "Minimal permissions for GNW governed agent operations"
  permissions = [
    "aiplatform.models.predict",
    "aiplatform.endpoints.get",
    "logging.logEntries.create",
    "monitoring.metricDescriptors.create",
    "monitoring.timeSeries.create",
    "secretmanager.versions.access",
    "storage.objects.get",
    "storage.objects.list",
  ]
}

# Grant custom role to GNW Agent SA
resource "google_project_iam_member" "gnw_agent_iam" {
  project = var.project_id
  role    = google_project_iam_custom_role.gnw_agent_role.id
  member  = "serviceAccount:${google_service_account.gnw_agent_sa.email}"
}

# Grant Vertex AI user role to Vertex SA
resource "google_project_iam_member" "gnw_vertex_iam" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.gnw_vertex_sa.email}"
}

# Grant Storage Object Viewer to both SAs
resource "google_storage_bucket_iam_member" "artifact_bucket_viewer" {
  bucket = google_storage_bucket.gnw_artifacts.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.gnw_agent_sa.email}"
}

resource "google_storage_bucket_iam_member" "artifact_bucket_viewer_vertex" {
  bucket = google_storage_bucket.gnw_artifacts.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.gnw_vertex_sa.email}"
}

# KMS Crypto Key Encrypter/Decrypter role
resource "google_kms_crypto_key_iam_member" "gnw_key_crypto_decrypter" {
  crypto_key_id = google_kms_crypto_key.gnw_key.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.gnw_agent_sa.email}"
}

# Workbench instance SA binding
resource "google_project_iam_member" "workbench_sa_binding" {
  count   = var.enable_workbench ? 1 : 0
  project = var.project_id
  role    = "roles/notebooks.admin"
  member  = "serviceAccount:${google_service_account.gnw_vertex_sa.email}"
}

# Output SA emails
output "gnw_agent_sa_email" {
  value = google_service_account.gnw_agent_sa.email
}

output "gnw_vertex_sa_email" {
  value = google_service_account.gnw_vertex_sa.email
}
