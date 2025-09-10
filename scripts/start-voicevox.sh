#!/bin/bash

# Voicevox Startup Script
# This script starts the Voicevox engine with the correct configuration

set -e

VOICEVOX_DIR="voicevox"

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

# Check if Voicevox directory exists
check_voicevox_setup() {
    if [[ ! -d "$VOICEVOX_DIR" ]]; then
        log_error "Voicevox directory not found. Please run setup first: npm run voicevox:setup"
        exit 1
    fi
    
    if [[ ! -f "$VOICEVOX_DIR/run" ]]; then
        log_error "Voicevox run script not found. Please run setup first: npm run voicevox:setup"
        exit 1
    fi
}

# Check if Voicevox is already running
check_voicevox_running() {
    if pgrep -f "voicevox_engine" > /dev/null; then
        log_warn "Voicevox engine is already running"
        return 0
    fi
    return 1
}

# Start Voicevox engine
start_voicevox() {
    log_info "Starting Voicevox engine..."
    
    # Change to voicevox directory
    cd "$VOICEVOX_DIR"
    
    # Start Voicevox engine
    # By default, it runs on port 50021
    if [[ "$1" == "--host" ]]; then
        log_info "Starting Voicevox with host access (0.0.0.0)"
        ./run --host 0.0.0.0
    else
        log_info "Starting Voicevox on localhost (127.0.0.1)"
        ./run
    fi
}

# Stop Voicevox engine
stop_voicevox() {
    log_info "Stopping Voicevox engine..."
    
    # Find and kill Voicevox processes
    local pids=$(pgrep -f "voicevox_engine")
    if [[ -n "$pids" ]]; then
        echo "$pids" | xargs kill -9
        log_info "Voicevox engine stopped"
    else
        log_warn "No Voicevox engine process found"
    fi
}

# Show Voicevox status
show_status() {
    if pgrep -f "voicevox_engine" > /dev/null; then
        local pid=$(pgrep -f "voicevox_engine")
        log_info "Voicevox engine is running (PID: $pid)"
        log_info "Access it at: http://localhost:50021"
    else
        log_warn "Voicevox engine is not running"
    fi
}

# Show help
show_help() {
    echo "Voicevox Engine Control Script"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  start [--host]   Start Voicevox engine (use --host for external access)"
    echo "  stop             Stop Voicevox engine"
    echo "  status           Show Voicevox engine status"
    echo "  restart          Restart Voicevox engine"
    echo "  help             Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 start           # Start on localhost only"
    echo "  $0 start --host    # Start with external access"
    echo "  $0 stop            # Stop Voicevox"
    echo "  $0 status          # Check status"
}

main() {
    case "${1:-start}" in
        "start")
            check_voicevox_setup
            if check_voicevox_running; then
                log_info "Voicevox is already running"
                exit 0
            fi
            start_voicevox "$2"
            ;;
        "stop")
            stop_voicevox
            ;;
        "status")
            show_status
            ;;
        "restart")
            stop_voicevox
            sleep 2
            check_voicevox_setup
            start_voicevox "$2"
            ;;
        "help"|"-h"|"--help")
            show_help
            ;;
        *)
            log_error "Unknown command: $1"
            show_help
            exit 1
            ;;
    esac
}

main "$@"