/**
 * GNW Zero-Trust GCP Infrastructure
 * sec(infra): VPC Service Controls for Vertex AI perimeter
 */

# VPC Service Controls Perimeter
resource "google_access_context_manager_service_perimeter" "gnw_perimeter" {
  parent         = "organizations/${var.organization_id}"
  name           = "accessPolicies/${var.access_policy_id}/servicePerimeters/${var.project_prefix}-gnw-perimeter"
  title          = "GNW Governed Agent Perimeter"
  description    = "VPC Service Controls perimeter for GNW governed agent workloads"
  use_explicit_dry_run_spec = false

  status {
    resources = [
      "projects/${var.project_id}"
    ]

    services = [
      "aiplatform.googleapis.com",
      "storage.googleapis.com",
      "bigquery.googleapis.com",
      "cloudkms.googleapis.com",
      "secretmanager.googleapis.com",
    ]

    access_levels = [
      "accessPolicies/${var.access_policy_id}/accessLevels/${var.project_prefix}-gnw-access-level"
    ]

    # Egress policies - restrict data exfiltration
    egress_policies {
      egress_from {
        identity_type = "IDENTITY_TYPE_UNSPECIFIED"
        sources {
          resource = "projects/${var.project_id}"
        }
      }
      egress_to {
        resources = []
        operations {
          service_name = "aiplatform.googleapis.com"
          method_selectors {
            method = "google.cloud.aiplatform.v1.PredictionService.Predict"
          }
        }
      }
    }

    # Ingress policies - restrict access
    ingress_policies {
      ingress_from {
        identity_type = "IDENTITY_TYPE_UNSPECIFIED"
        sources {
          resource = "projects/${var.project_id}"
        }
      }
      ingress_to {
        resources = [
          "projects/${var.project_id}"
        ]
        operations {
          service_name = "aiplatform.googleapis.com"
          method_selectors {
            method = "google.cloud.aiplatform.v1.PredictionService.Predict"
          }
        }
      }
    }
  }

  lifecycle {
    prevent_destroy = false
  }
}

# Access Level for perimeter
resource "google_access_context_manager_access_level" "gnw_access_level" {
  parent = "accessPolicies/${var.access_policy_id}"
  name   = "accessPolicies/${var.access_policy_id}/accessLevels/${var.project_prefix}-gnw-access-level"
  title  = "GNW Access Level"

  basic {
    conditions {
      ip_subnetworks = var.allowed_ip_ranges
      regions        = [var.region]
    }

    combining_function = "AND"
  }
}

# VPC Service Controls Bridge (optional for premium tier)
resource "google_access_context_manager_service_perimeter_bridge" "gnw_bridge" {
  count  = var.vpc_sc_tier == "PREMIUM" ? 1 : 0
  parent = "organizations/${var.organization_id}"
  name   = "accessPolicies/${var.access_policy_id}/servicePerimeters/${var.project_prefix}-gnw-bridge"
  title  = "GNW Bridge Perimeter"

  status {
    resources = [
      "projects/${var.project_id}"
    ]
    services = [
      "aiplatform.googleapis.com",
    ]
  }
}

# Outputs
output "perimeter_name" {
  value = google_access_context_manager_service_perimeter.gnw_perimeter.name
}

output "access_level_name" {
  value = google_access_context_manager_access_level.gnw_access_level.name
}
