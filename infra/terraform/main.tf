/**
 * GNW Zero-Trust GCP Infrastructure
 * sec(infra): Main Terraform configuration for Vertex AI with least-privilege IAM
 */

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    bucket = var.terraform_state_bucket
    prefix = "gnw-governed-agent-v4/infra"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# Enable required APIs
resource "google_project_service" "required_apis" {
  for_each = toset([
    "compute.googleapis.com",
    "container.googleapis.com",
    "aiplatform.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudkms.googleapis.com",
  ])

  service            = each.key
  disable_on_destroy = false
}

# VPC Network
resource "google_compute_network" "gnw_vpc" {
  name                            = "${var.project_prefix}-gnw-vpc"
  auto_create_subnetworks         = false
  routing_mode                    = "REGIONAL"
  delete_default_routes_on_create = false
}

# Private Subnet for Vertex AI
resource "google_compute_subnetwork" "gnw_subnet" {
  name                     = "${var.project_prefix}-gnw-subnet"
  ip_cidr_range            = var.subnet_cidr
  region                   = var.region
  network                  = google_compute_network.gnw_vpc.id
  private_ip_google_access = true

  log_config {
    aggregation_interval = "INTERVAL_5_SEC"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

# Vertex AI Workbench Instance (optional)
resource "google_notebooks_instance" "gnw_workbench" {
  count        = var.enable_workbench ? 1 : 0
  name         = "${var.project_prefix}-gnw-workbench"
  location     = var.region
  machine_type = var.workbench_machine_type

  vm_image {
    project      = "deeplearning-platform-release"
    image_family = "common-cu113-notebooks-debian-11"
  }

  network      = google_compute_network.gnw_vpc.id
  subnet       = google_compute_subnetwork.gnw_subnet.id

  no_public_ip         = true
  no_proxy_access      = false
  enable_monitoring    = true

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  metadata = {
    "enable-guest-attributes" = "TRUE"
    "proxy-mode"              = "service_account"
  }

  lifecycle {
    prevent_destroy = false
  }
}

# Cloud Storage Bucket for artifacts
resource "google_storage_bucket" "gnw_artifacts" {
  name                        = "${var.project_prefix}-gnw-artifacts-${var.project_id}"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  encryption {
    default_kms_key_name = google_kms_crypto_key.gnw_key.id
  }
}

# KMS Key for encryption
resource "google_kms_key_ring" "gnw_keyring" {
  name     = "${var.project_prefix}-gnw-keyring"
  location = var.region
}

resource "google_kms_crypto_key" "gnw_key" {
  name            = "${var.project_prefix}-gnw-key"
  key_ring        = google_kms_key_ring.gnw_keyring.id
  rotation_period = "7776000s" # 90 days

  lifecycle {
    prevent_destroy = false
  }
}

# Outputs
output "vpc_id" {
  value = google_compute_network.gnw_vpc.id
}

output "subnet_id" {
  value = google_compute_subnetwork.gnw_subnet.id
}

output "artifact_bucket" {
  value = google_storage_bucket.gnw_artifacts.name
}

output "kms_key_id" {
  value = google_kms_crypto_key.gnw_key.id
}
