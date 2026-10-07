/**
 * GNW Zero-Trust GCP Infrastructure
 * sec(infra): Variable definitions for Terraform
 */

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "project_prefix" {
  description = "Prefix for resource names"
  type        = string
  default     = "gnw"
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-central1"
}

variable "subnet_cidr" {
  description = "CIDR range for private subnet"
  type        = string
  default     = "10.0.0.0/24"
}

variable "enable_workbench" {
  description = "Enable Vertex AI Workbench instance"
  type        = bool
  default     = true
}

variable "workbench_machine_type" {
  description = "Machine type for Workbench instance"
  type        = string
  default     = "n1-standard-4"
}

variable "terraform_state_bucket" {
  description = "GCS bucket for Terraform state"
  type        = string
}

variable "allowed_ip_ranges" {
  description = "CIDR ranges allowed to access resources"
  type        = list(string)
  default     = []
}

variable "enable_private_google_access" {
  description = "Enable private Google access for VMs"
  type        = bool
  default     = true
}

variable "vpc_sc_tier" {
  description = "VPC Service Controls tier (STANDARD or PREMIUM)"
  type        = string
  default     = "STANDARD"
}

variable "log_retention_days" {
  description = "Retention period for logs in days"
  type        = number
  default     = 30
}

variable "enable_audit_logs" {
  description = "Enable Cloud Audit Logs"
  type        = bool
  default     = true
}

variable "monitoring_alert_email" {
  description = "Email for monitoring alerts"
  type        = string
}
