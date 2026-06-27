# docker-bake.hcl — Multi-arch Docker Bake configuration
# Usage:
#   docker buildx bake        # build both platforms
#   docker buildx bake --push  # build and push to ghcr.io

variable "UJIMA_VERSION" {
  default = "latest"
}

variable "REGISTRY" {
  default = "ghcr.io/ujimaagents/ujima-agents"
}

group "default" {
  targets = ["ujima"]
}

target "ujima" {
  context       = "."
  dockerfile    = "Dockerfile"
  args          = {
    UJIMA_VERSION = UJIMA_VERSION
  }
  tags          = [
    "${REGISTRY}:latest",
    "${REGISTRY}:${UJIMA_VERSION}",
  ]
  platforms     = [
    "linux/amd64",
    "linux/arm64",
  ]
  attest        = [
    "type=provenance,mode=min",
  ]
}
