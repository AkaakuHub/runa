#!/bin/bash

# Voicevox Environment Setup Script
# This script detects the OS and downloads the correct Voicevox binary

set -e

VOICEVOX_DIR="voicevox"
VOICEVOX_GITHUB_REPO="VOICEVOX/voicevox_engine"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get latest Voicevox version from GitHub API
get_latest_version() {
    local api_url="https://api.github.com/repos/${VOICEVOX_GITHUB_REPO}/releases/latest"
    local version=""
    
    if command -v curl &> /dev/null; then
        version=$(curl -s "$api_url" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/' | sed 's/^v//')
    elif command -v wget &> /dev/null; then
        version=$(wget -q -O - "$api_url" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/' | sed 's/^v//')
    else
        log_error "Neither curl nor wget is available. Please install one of them."
        exit 1
    fi
    
    if [[ -z "$version" ]]; then
        log_error "Failed to get latest version from GitHub API"
        exit 1
    fi
    
    echo "$version"
}

# Download with resume capability
download_with_resume() {
    local url="$1"
    local output="$2"
    
    log_info "Starting download: $url"
    
    if command -v curl &> /dev/null; then
        # Check if file exists for resume
        if [[ -f "$output" ]]; then
            log_info "Resuming download with curl..."
            curl -L -C - -o "$output" "$url"
        else
            log_info "Starting new download with curl..."
            curl -L -o "$output" "$url"
        fi
    elif command -v wget &> /dev/null; then
        # Check if file exists for resume
        if [[ -f "$output" ]]; then
            log_info "Resuming download with wget..."
            wget -c -O "$output" "$url"
        else
            log_info "Starting new download with wget..."
            wget -O "$output" "$url"
        fi
    else
        log_error "Neither curl nor wget is available. Please install one of them."
        exit 1
    fi
    
    # Verify download completed successfully
    if [[ $? -eq 0 ]]; then
        local file_size=$(stat -f%z "$output" 2>/dev/null || stat -c%s "$output" 2>/dev/null || echo "0")
        log_info "Download completed successfully: $output (${file_size} bytes)"
    else
        log_error "Download failed"
        exit 1
    fi
}

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        if [[ "$(uname -m)" == "arm64" ]]; then
            echo "macos-arm64"
        else
            echo "macos-x64"
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if [[ "$(uname -m)" == "x86_64" ]]; then
            echo "linux-x64"
        elif [[ "$(uname -m)" == "aarch64" ]]; then
            echo "linux-arm64"
        else
            log_error "Unsupported Linux architecture: $(uname -m)"
            exit 1
        fi
    else
        log_error "Unsupported OS: $OSTYPE"
        exit 1
    fi
}

# Download and extract Voicevox
download_voicevox() {
    local os=$1
    local version=$2
    local download_url=""
    local archive_name=""
    
    case $os in
        "macos-arm64")
            download_url="https://github.com/VOICEVOX/voicevox_engine/releases/download/${version}/voicevox_engine-macos-arm64-${version}.7z.001"
            archive_name="voicevox_engine-macos-arm64-${version}.7z.001"
            ;;
        "macos-x64")
            download_url="https://github.com/VOICEVOX/voicevox_engine/releases/download/${version}/voicevox_engine-macos-x64-${version}.7z.001"
            archive_name="voicevox_engine-macos-x64-${version}.7z.001"
            ;;
        "linux-x64")
            download_url="https://github.com/VOICEVOX/voicevox_engine/releases/download/${version}/voicevox_engine-linux-cpu-x64-${version}.7z.001"
            archive_name="voicevox_engine-linux-cpu-x64-${version}.7z.001"
            ;;
        "linux-arm64")
            download_url="https://github.com/VOICEVOX/voicevox_engine/releases/download/${version}/voicevox_engine-linux-cpu-arm64-${version}.7z.001"
            archive_name="voicevox_engine-linux-cpu-arm64-${version}.7z.001"
            ;;
    esac
    
    log_info "Detected OS: $os"
    log_info "Downloading Voicevox engine version ${version}..."
    
    # Create voicevox directory if it doesn't exist
    mkdir -p "$VOICEVOX_DIR"
    cd "$VOICEVOX_DIR"
    
    # Check if archive already exists and is complete
    if [[ -f "$archive_name" ]]; then
        local file_size=$(stat -f%z "$archive_name" 2>/dev/null || stat -c%s "$archive_name" 2>/dev/null || echo "0")
        if [[ $file_size -gt 0 ]]; then
            log_info "Archive already exists: $archive_name (${file_size} bytes)"
            log_info "Checking if download is complete..."
            
            # Try to get expected size from GitHub API
            local expected_size=""
            if command -v curl &> /dev/null; then
                expected_size=$(curl -sI "$download_url" | grep -i content-length | awk '{print $2}' | tr -d '\r')
            elif command -v wget &> /dev/null; then
                expected_size=$(wget --spider --server-response "$download_url" 2>&1 | grep -i content-length | awk '{print $2}' | tr -d '\r')
            fi
            
            if [[ -n "$expected_size" && "$file_size" -eq "$expected_size" ]]; then
                log_info "Download is complete, skipping download..."
            else
                log_info "Download is incomplete or size mismatch, resuming download..."
                download_with_resume "$download_url" "$archive_name"
            fi
        else
            log_info "Archive exists but is empty, re-downloading..."
            download_with_resume "$download_url" "$archive_name"
        fi
    else
        # Download the archive
        download_with_resume "$download_url" "$archive_name"
    fi
    
    # Extract the archive
    log_info "Extracting archive..."
    if [[ "$archive_name" == *.7z.001 ]]; then
        if command -v 7z &> /dev/null; then
            7z x "$archive_name"
        elif command -v 7zz &> /dev/null; then
            7zz x "$archive_name"
        else
            log_error "7z is not available. Please install it."
            exit 1
        fi
    elif [[ "$archive_name" == *.zip ]]; then
        if command -v unzip &> /dev/null; then
            unzip -o "$archive_name"
        else
            log_error "unzip is not available. Please install it."
            exit 1
        fi
    elif [[ "$archive_name" == *.tar.gz ]]; then
        if command -v tar &> /dev/null; then
            tar -xzf "$archive_name"
        else
            log_error "tar is not available. Please install it."
            exit 1
        fi
    fi
    
    # Clean up archive
    rm "$archive_name"
    
    # Find the extracted directory (it might have a different name)
    local extracted_dir=$(find . -maxdepth 1 -type d -name "voicevox_engine-*" | head -n 1)
    if [[ -n "$extracted_dir" && "$extracted_dir" != "." ]]; then
        # Move contents to current directory if extracted into a subdirectory
        mv "$extracted_dir"/* .
        rmdir "$extracted_dir" 2>/dev/null || true
    fi
    
    # Also check for directories with version number
    local version_dir=$(find . -maxdepth 1 -type d -name "voicevox_engine-${version}*" | head -n 1)
    if [[ -n "$version_dir" && "$version_dir" != "." ]]; then
        # Move contents to current directory if extracted into a subdirectory
        mv "$version_dir"/* .
        rmdir "$version_dir" 2>/dev/null || true
    fi
    
    # Check for OS-specific directories (like macos-arm64, linux-x64, etc.)
    local os_dir=$(find . -maxdepth 1 -type d -name "macos-*" -o -name "linux-*" | head -n 1)
    if [[ -n "$os_dir" && "$os_dir" != "." ]]; then
        # Move contents to current directory if extracted into a subdirectory
        mv "$os_dir"/* .
        rmdir "$os_dir" 2>/dev/null || true
    fi
    
    # Make run script executable
    if [[ -f "run" ]]; then
        chmod +x run
    fi
    
    cd ..
    log_info "Voicevox engine setup completed successfully!"
    log_info "Version ${version} has been installed for ${os}"
}

# Check if Voicevox is already set up
check_existing_setup() {
    if [[ -d "$VOICEVOX_DIR" && -f "$VOICEVOX_DIR/run" ]]; then
        log_warn "Voicevox directory already exists. Remove it to re-download: rm -rf $VOICEVOX_DIR"
        return 0
    fi
    return 1
}

main() {
    log_info "Starting Voicevox environment setup..."
    
    if check_existing_setup; then
        exit 0
    fi
    
    local os=$(detect_os)
    local version=$(get_latest_version)
    log_info "Latest Voicevox version: ${version}"
    
    download_voicevox "$os" "$version"

    mkdir -p tts-cache
    
    log_info "Voicevox environment setup completed!"
    log_info "You can now start Voicevox with: npm run voicevox:start"
}

main "$@"