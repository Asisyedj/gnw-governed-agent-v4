/**
 * GNW Zero-Trust GCP Infrastructure
 * sec(infra): Cloud Audit Logs and monitoring alert sinks
 */

# Cloud Audit Log Config
resource "google_project_iam_audit_config" "gnw_audit_config" {
  count   = var.enable_audit_logs ? 1 : 0
  project = var.project_id
  service = "allServices"

  audit_log_config {
    log_type = "DATA_READ"
  }

  audit_log_config {
    log_type = "DATA_WRITE"
  }

  audit_log_config {
    log_type = "ADMIN_READ"
  }
}

# Log Sink for Audit Logs to BigQuery
resource "google_project_iam_member" "bigquery_data_editor" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:cloud-logs@system.gserviceaccount.com"
}

resource "google_logging_project_sink" "gnw_audit_sink_bq" {
  name             = "${var.project_prefix}-gnw-audit-sink-bq"
  destination      = "bigquery.googleapis.com/projects/${var.project_id}/datasets/${var.project_prefix}_audit_logs"
  filter           = 'logName="projects/${var.project_id}/logs/cloudaudit.googleapis.com%2Factivity"'
  unique_writer_identity = true
}

resource "google_bigquery_dataset" "audit_logs" {
  dataset_id    = "${var.project_prefix}_audit_logs"
  friendly_name = "GNW Audit Logs"
  description   = "Dataset for GNW audit logs"
  location      = var.region
  delete_contents_on_destroy = false
}

# Log Sink for monitoring to Pub/Sub
resource "google_logging_project_sink" "gnw_monitoring_sink" {
  name        = "${var.project_prefix}-gnw-monitoring-sink"
  destination = "pubsub.googleapis.com/projects/${var.project_id}/topics/${var.project_prefix}-gnw-monitoring"
  filter      = 'severity>=ERROR'
  unique_writer_identity = true
}

resource "google_pubsub_topic" "gnw_monitoring_topic" {
  name = "${var.project_prefix}-gnw-monitoring"
}

# Monitoring Alert Policy for errors
resource "google_monitoring_alert_policy" "gnw_error_alert" {
  display_name = "GNW Error Rate Alert"
  combiner     = "OR"

  conditions {
    display_name = "Error Rate > 5%"

    condition_threshold {
      filter          = "resource.type=\"global\" AND metric.type=\"logging.googleapis.com/byte_count\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.05
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = [
    google_monitoring_notification_channel.gnw_email_channel.id
  ]

  alert_strategy {
    notification_rate_limit {
      period = "300s"
    }
  }

  documentation {
    content   = "GNW governed agent error rate exceeded threshold. Check logs immediately."
    mime_type = "text/markdown"
  }
}

# Notification channel for alerts
resource "google_monitoring_notification_channel" "gnw_email_channel" {
  display_name = "GNW Email Alerts"
  type         = "email"

  labels = {
    email_address = var.monitoring_alert_email
  }
}

# Log-based metric for custom monitoring
resource "google_logging_metric" "gnw_custom_metric" {
  name   = "${var.project_prefix}_gnw_custom_events"
  filter = 'resource.type="global" AND jsonPayload.eventType=\"gnw_event\"'

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    display_name = "GNW Custom Events"
  }
}

# Outputs
output "audit_sink_bq" {
  value = google_logging_project_sink.gnw_audit_sink_bq.id
}

output "monitoring_sink" {
  value = google_logging_project_sink.gnw_monitoring_sink.id
}

output "alert_policy_id" {
  value = google_monitoring_alert_policy.gnw_error_alert.id
}
