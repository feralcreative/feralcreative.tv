#!/bin/bash

################################################################################
# Pre-Build Hook for Cats Deployment
# Generates mediamtx.yml from template using environment variables
################################################################################

set -e

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[PRE-BUILD]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[PRE-BUILD]${NC} $1"
}

log_error() {
    echo -e "${RED}[PRE-BUILD]${NC} $1"
}

log_info "Generating mediamtx.yml from template..."

# Check if .env file exists
if [ ! -f .env ]; then
    log_error ".env file not found"
    log_error "Please create .env file with CAMERA_USER and CAMERA_PASS"
    exit 1
fi

# Check if template exists
if [ ! -f mediamtx.yml.template ]; then
    log_error "mediamtx.yml.template not found"
    exit 1
fi

# Load environment variables from .env
export $(cat .env | grep -v '^#' | xargs)

# Check if required variables are set
if [ -z "$CAMERA_USER" ] || [ -z "$CAMERA_PASS" ]; then
    log_error "CAMERA_USER and CAMERA_PASS must be set in .env file"
    exit 1
fi

# Generate mediamtx.yml using envsubst
if envsubst < mediamtx.yml.template > mediamtx.yml; then
    log_success "mediamtx.yml generated successfully"
else
    log_error "Failed to generate mediamtx.yml"
    exit 1
fi

log_info "Building backend Docker image..."

# Build backend image
if docker build --platform linux/amd64 -t cats-backend:latest ./backend; then
    log_success "Backend image built successfully"
else
    log_error "Failed to build backend image"
    exit 1
fi

log_success "Pre-build hook completed"
