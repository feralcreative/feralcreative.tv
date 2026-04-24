#!/bin/bash

################################################################################
# Docker Deployment Script
# Deploys application to Synology NAS via SSH with certificate auth
################################################################################

set -e

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load configuration
if [ ! -f "$PROJECT_ROOT/deploy.config" ]; then
    echo "ERROR: deploy.config not found in project root"
    exit 1
fi

source "$PROJECT_ROOT/deploy.config"

# Derived configuration
NAS_SSH_HOST="${NAS_USER}@${NAS_HOST}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

################################################################################
# Helper Functions
################################################################################

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

get_ssh_cmd() {
    local cmd="ssh -p $NAS_SSH_PORT"
    if [ -z "$USE_SSH_AGENT" ] && [ -n "$SSH_KEY_PATH" ]; then
        cmd="$cmd -i $SSH_KEY_PATH"
    fi
    echo "$cmd"
}

check_ssh_key() {
    log_info "Checking for SSH certificate..."

    # If SSH_KEY_PATH is set, use it
    if [ -n "$SSH_KEY_PATH" ]; then
        if [ ! -f "$SSH_KEY_PATH" ]; then
            log_error "SSH key not found at: $SSH_KEY_PATH"
            exit 1
        fi
        log_success "SSH key found: $SSH_KEY_PATH"
        return
    fi

    # Try common locations
    if [ -f "$HOME/.ssh/id_ed25519" ]; then
        SSH_KEY_PATH="$HOME/.ssh/id_ed25519"
        log_success "SSH key found: $SSH_KEY_PATH"
        return
    elif [ -f "$HOME/.ssh/id_rsa" ]; then
        SSH_KEY_PATH="$HOME/.ssh/id_rsa"
        log_success "SSH key found: $SSH_KEY_PATH"
        return
    fi

    # Check if SSH agent has keys
    if ssh-add -l > /dev/null 2>&1; then
        log_success "Using SSH agent for authentication"
        USE_SSH_AGENT=1
        return
    fi

    log_error "No SSH key found. Please provide SSH_KEY_PATH environment variable or add keys to SSH agent."
    log_info "Usage: SSH_KEY_PATH=/path/to/key ./deploy.sh"
    exit 1
}

test_ssh_connection() {
    log_info "Testing SSH connection to ${NAS_SSH_HOST}:${NAS_SSH_PORT}..."

    local ssh_cmd=$(get_ssh_cmd)

    if $ssh_cmd -o ConnectTimeout=5 "$NAS_SSH_HOST" "echo 'SSH connection successful'" > /dev/null 2>&1; then
        log_success "SSH connection successful"
    else
        log_error "Failed to connect to ${NAS_SSH_HOST}:${NAS_SSH_PORT}"
        log_info "Make sure your SSH key is added to the NAS authorized_keys"
        exit 1
    fi
}

load_env_file() {
    if [ -f "$PROJECT_ROOT/.env" ]; then
        log_info "Loading environment variables from .env..."
        set -a
        source "$PROJECT_ROOT/.env"
        set +a
        log_success "Environment variables loaded"
    else
        log_warning "No .env file found - some features may be disabled"
        log_info "Copy .env.example to .env and configure as needed"
    fi
}

run_pre_build_hook() {
    if [ -n "$PRE_BUILD_HOOK" ] && [ -f "$PROJECT_ROOT/$PRE_BUILD_HOOK" ]; then
        log_info "Running pre-build hook: $PRE_BUILD_HOOK"
        cd "$PROJECT_ROOT"
        bash "$PRE_BUILD_HOOK"
        log_success "Pre-build hook completed"
    fi
}

run_post_deploy_hook() {
    if [ -n "$POST_DEPLOY_HOOK" ] && [ -f "$PROJECT_ROOT/$POST_DEPLOY_HOOK" ]; then
        log_info "Running post-deploy hook: $POST_DEPLOY_HOOK"
        cd "$PROJECT_ROOT"
        bash "$POST_DEPLOY_HOOK"
        log_success "Post-deploy hook completed"
    fi
}

build_image() {
    log_info "Building Docker image locally..."

    cd "$PROJECT_ROOT"

    if docker build --platform "$DOCKER_PLATFORM" -t "$IMAGE_NAME" .; then
        log_success "Docker image built successfully"
    else
        log_error "Failed to build Docker image"
        exit 1
    fi
}

save_and_transfer_image() {
    log_info "Saving Docker image to tar.gz..."

    local temp_file="/tmp/${PROJECT_NAME}-$(date +%s).tar.gz"

    if docker save "$IMAGE_NAME" | gzip > "$temp_file"; then
        log_success "Image saved to $temp_file"
    else
        log_error "Failed to save Docker image"
        exit 1
    fi

    log_info "Transferring image to NAS (this may take a few minutes)..."

    local ssh_cmd=$(get_ssh_cmd)

    # Ensure deploy path exists on NAS
    $ssh_cmd "$NAS_SSH_HOST" "mkdir -p ${NAS_DEPLOY_PATH}" || true

    # Use deploy path for temporary storage
    local nas_temp_file="${NAS_DEPLOY_PATH}/${PROJECT_NAME}.tar.gz"

    # Transfer using cat and ssh pipe (more reliable than scp)
    if cat "$temp_file" | $ssh_cmd "$NAS_SSH_HOST" "cat > ${nas_temp_file}"; then
        log_success "Image transferred successfully"
    else
        log_error "Failed to transfer image to NAS"
        rm -f "$temp_file"
        exit 1
    fi

    rm -f "$temp_file"
}

load_image_on_nas() {
    log_info "Loading Docker image on NAS..."

    local ssh_cmd=$(get_ssh_cmd)
    local nas_temp_file="${NAS_DEPLOY_PATH}/${PROJECT_NAME}.tar.gz"

    if $ssh_cmd "$NAS_SSH_HOST" "/usr/local/bin/docker load < ${nas_temp_file} && rm ${nas_temp_file}"; then
        log_success "Docker image loaded on NAS"
    else
        log_error "Failed to load Docker image on NAS"
        exit 1
    fi
}

save_and_transfer_backend_image() {
    log_info "Saving backend Docker image to tar.gz..."

    local temp_file="/tmp/cats-backend-$(date +%s).tar.gz"

    if docker save "cats-backend:latest" | gzip > "$temp_file"; then
        log_success "Backend image saved to $temp_file"
    else
        log_error "Failed to save backend Docker image"
        exit 1
    fi

    log_info "Transferring backend image to NAS (this may take a few minutes)..."

    local ssh_cmd=$(get_ssh_cmd)
    local nas_temp_file="${NAS_DEPLOY_PATH}/cats-backend.tar.gz"

    # Transfer using cat and ssh pipe (more reliable than scp)
    if cat "$temp_file" | $ssh_cmd "$NAS_SSH_HOST" "cat > ${nas_temp_file}"; then
        log_success "Backend image transferred successfully"
    else
        log_error "Failed to transfer backend image to NAS"
        rm -f "$temp_file"
        exit 1
    fi

    rm -f "$temp_file"
}

load_backend_image_on_nas() {
    log_info "Loading backend Docker image on NAS..."

    local ssh_cmd=$(get_ssh_cmd)
    local nas_temp_file="${NAS_DEPLOY_PATH}/cats-backend.tar.gz"

    if $ssh_cmd "$NAS_SSH_HOST" "/usr/local/bin/docker load < ${nas_temp_file} && rm ${nas_temp_file}"; then
        log_success "Backend Docker image loaded on NAS"
    else
        log_error "Failed to load backend Docker image on NAS"
        exit 1
    fi
}

prepare_nas_directories() {
    log_info "Preparing NAS directories..."

    local ssh_cmd=$(get_ssh_cmd)

    # Create base directories
    $ssh_cmd "$NAS_SSH_HOST" << EOF
mkdir -p ${NAS_DEPLOY_PATH}/data
mkdir -p ${NAS_DEPLOY_PATH}/logs
chmod 755 ${NAS_DEPLOY_PATH}
chmod 755 ${NAS_DEPLOY_PATH}/data
chmod 755 ${NAS_DEPLOY_PATH}/logs
EOF

    # Create custom directories if specified
    if [ -n "$CUSTOM_DIRS" ]; then
        for dir in $CUSTOM_DIRS; do
            log_info "Creating custom directory: $dir"
            $ssh_cmd "$NAS_SSH_HOST" "mkdir -p ${NAS_DEPLOY_PATH}/${dir} && chmod 755 ${NAS_DEPLOY_PATH}/${dir}"
        done
    fi

    log_success "NAS directories prepared"
}

transfer_data_files() {
    if [ -z "$DATA_FILES" ]; then
        log_info "No data files to transfer"
        return 0
    fi

    log_info "Transferring data files to NAS..."

    local ssh_cmd=$(get_ssh_cmd)

    for file in $DATA_FILES; do
        if [ -f "$PROJECT_ROOT/$file" ]; then
            local filename=$(basename "$file")
            log_info "Transferring $filename..."
            if cat "$PROJECT_ROOT/$file" | $ssh_cmd "$NAS_SSH_HOST" "cat > ${NAS_DEPLOY_PATH}/data/${filename}"; then
                log_success "$filename transferred"
            else
                log_error "Failed to transfer $filename"
                exit 1
            fi
        else
            log_warning "Data file not found: $file"
        fi
    done

    log_success "Data files transferred successfully"
}

transfer_compose_file() {
    # Use production compose file if it exists, otherwise use default
    local compose_file="docker-compose.prod.yml"
    if [ ! -f "$PROJECT_ROOT/$compose_file" ]; then
        compose_file="docker-compose.yml"
    fi

    if [ ! -f "$PROJECT_ROOT/$compose_file" ]; then
        log_warning "No docker-compose file found - skipping"
        return 0
    fi

    log_info "Transferring $compose_file to NAS..."

    local ssh_cmd=$(get_ssh_cmd)

    if cat "$PROJECT_ROOT/$compose_file" | $ssh_cmd "$NAS_SSH_HOST" "cat > ${NAS_DEPLOY_PATH}/docker-compose.yml"; then
        log_success "$compose_file transferred as docker-compose.yml"
    else
        log_error "Failed to transfer $compose_file"
        exit 1
    fi
}

deploy_container() {
    log_info "Deploying container on NAS..."

    local ssh_cmd=$(get_ssh_cmd)

    $ssh_cmd "$NAS_SSH_HOST" << EOF
cd ${NAS_DEPLOY_PATH}
# Stop and remove all containers from compose
/usr/local/bin/docker-compose down --remove-orphans || true
# Force remove any lingering containers with the same name
/usr/local/bin/docker rm -f cats-web cats-mediamtx cats-backend 2>/dev/null || true
# Start fresh
/usr/local/bin/docker-compose up -d
EOF

    log_success "Container deployed"
}

verify_deployment() {
    log_info "Verifying deployment..."

    sleep 3

    local ssh_cmd=$(get_ssh_cmd)

    if $ssh_cmd "$NAS_SSH_HOST" "/usr/local/bin/docker ps | grep -q $CONTAINER_NAME"; then
        log_success "Container is running"
    else
        log_error "Container failed to start"
        log_info "Checking logs..."
        $ssh_cmd "$NAS_SSH_HOST" "/usr/local/bin/docker logs $CONTAINER_NAME" || true
        exit 1
    fi
}

purge_cloudflare_cache() {
    log_info "Checking for Cloudflare credentials..."

    # Check for Cloudflare credentials
    if [ -z "$CLOUDFLARE_API_TOKEN" ] || [ -z "$CLOUDFLARE_ZONE_ID" ]; then
        log_warning "CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID not set in .env"
        log_info "Skipping Cloudflare cache purge"
        log_info "Add these to your .env file to enable automatic cache purging:"
        log_info "  CLOUDFLARE_API_TOKEN=your_api_token"
        log_info "  CLOUDFLARE_ZONE_ID=your_zone_id"
        return 0
    fi

    log_info "Purging Cloudflare cache..."
    log_info "Zone ID: $CLOUDFLARE_ZONE_ID"

    PURGE_RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"purge_everything":true}')

    log_info "Cloudflare response: $PURGE_RESPONSE"

    # Check if purge was successful
    if echo "$PURGE_RESPONSE" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
        log_success "Cloudflare cache purged successfully"
    else
        log_error "Failed to purge Cloudflare cache"
        log_info "Full response: $PURGE_RESPONSE"
        log_warning "You may need to manually purge the cache in Cloudflare dashboard"
        # Don't exit - cache purge failure shouldn't stop deployment
    fi
}

show_status() {
    log_info "Checking container status..."

    local ssh_cmd=$(get_ssh_cmd)

    $ssh_cmd "$NAS_SSH_HOST" << EOF
echo "=== Container Status ==="
/usr/local/bin/docker ps | grep -E "cats-web|cats-backend|cats-mediamtx" || echo "Containers not running"
echo ""
echo "=== Recent Logs ==="
/usr/local/bin/docker logs --tail 20 cats-web 2>/dev/null || echo "No logs available"
EOF
}

################################################################################
# Main Deployment Flow
################################################################################

main() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║         Docker Deployment to Synology NAS                      ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""

    log_info "Deployment Configuration:"
    log_info "  Project: $PROJECT_NAME"
    log_info "  Domain: $DOMAIN"
    log_info "  NAS Host: $NAS_HOST"
    log_info "  Deploy Path: $NAS_DEPLOY_PATH"
    log_info "  Container: $CONTAINER_NAME"
    echo ""

    # Load environment variables
    load_env_file

    # Check SSH key
    check_ssh_key

    # Test SSH connection
    test_ssh_connection

    # Run pre-build hook
    run_pre_build_hook

    # Build image locally
    build_image

    # Save and transfer web image
    save_and_transfer_image

    # Load web image on NAS
    load_image_on_nas

    # Save and transfer backend image
    save_and_transfer_backend_image

    # Load backend image on NAS
    load_backend_image_on_nas

    # Prepare NAS directories
    prepare_nas_directories

    # Transfer data files
    transfer_data_files

    # Transfer docker-compose.yml
    transfer_compose_file

    # Deploy container
    deploy_container

    # Verify deployment
    verify_deployment

    # Run post-deploy hook
    run_post_deploy_hook

    # Purge Cloudflare cache
    purge_cloudflare_cache

    # Show status
    show_status

    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║                    DEPLOYMENT COMPLETE                         ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    log_success "Application deployed to: https://${DOMAIN}"
    echo ""
}

# Run main function
main "$@"
