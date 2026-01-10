# Session Sharing Network Access Guide

## Overview

The embedded WebSocket server for terminal session sharing supports multiple network access modes:

1. **Localhost Only** (`127.0.0.1`) - Only accessible from the same machine
2. **Local Network** (`0.0.0.0`) - Accessible from devices on the same network
3. **Internet Access** - Requires port forwarding or tunneling service

## Current Implementation

By default, the server binds to `0.0.0.0` (all interfaces), making it accessible on your local network. This allows:
- ✅ Sharing sessions with devices on the same Wi-Fi/LAN
- ✅ No additional configuration needed for local network access
- ⚠️ Requires firewall/router configuration for internet access

## Configuration Options

### Option 1: Local Network Access (Default)

The server binds to `0.0.0.0` by default, allowing access from your local network.

**Configuration (in `config.yaml`):**
```yaml
sessionSharing:
  bindHost: "0.0.0.0"  # Default: accessible on local network
  port: 0              # Default: auto-assign available port
```

**How to share:**
1. Share the session as normal
2. Note the port number from the console log
3. Find your machine's IP address:
   - macOS/Linux: `ifconfig | grep "inet "` or `ip addr show`
   - Windows: `ipconfig`
4. Share URL: `ws://<your-ip>:<port>/session`

**Example:**
- Your IP: `192.168.1.100`
- Server port: `54321`
- Shareable URL: `ws://192.168.1.100:54321/session`

### Option 2: Internet Access via Port Forwarding

For internet access, configure your router to forward the WebSocket port:

1. **Enable port forwarding on your router:**
   - Log into your router's admin panel
   - Forward external port (e.g., 54321) to your machine's IP and the server port
   - Use TCP protocol

2. **Configure firewall:**
   - Allow incoming connections on the WebSocket port
   - macOS: System Preferences → Security → Firewall
   - Linux: `sudo ufw allow <port>/tcp`
   - Windows: Windows Defender Firewall → Advanced Settings

3. **Share your public IP:**
   - Find your public IP: Visit https://whatismyipaddress.com/
   - Share URL: `ws://<public-ip>:<port>/session`

**⚠️ Security Warning:** Exposing ports directly to the internet requires proper authentication and security measures. Consider using a tunneling service (Option 3) instead.

### Option 3: Internet Access via Tunneling Service (Recommended)

For secure internet access without port forwarding, use a tunneling service:

#### Using ngrok (Recommended)
```bash
# Install ngrok
npm install -g ngrok
# or download from https://ngrok.com/

# Start tunnel (replace <port> with your WebSocket server port)
ngrok tcp <port>
```

The ngrok URL will be displayed. Use this as the public URL.

#### Using localtunnel
```bash
# Install localtunnel
npm install -g localtunnel

# Start tunnel
lt --port <port>
```

#### Integration with Tlink (Future Enhancement)

Future versions will integrate tunneling services directly:

```yaml
sessionSharing:
  bindHost: "0.0.0.0"
  port: 0
  enableTunneling: true
  tunnelService: "ngrok"  # Options: "ngrok", "localtunnel", "cloudflare"
  tunnelAuth: "your-auth-token"  # Optional: for authenticated services
```

### Option 4: Localhost Only (Maximum Security)

For maximum security (only local machine access):

**Configuration:**
```yaml
sessionSharing:
  bindHost: "127.0.0.1"  # Localhost only
  port: 0
```

This is useful for:
- Development/testing
- Maximum security (no network exposure)
- Using with VPN (connect via VPN, then access via localhost)

## Security Considerations

1. **Authentication:** All shared sessions require a token for access
2. **Password Protection:** Use password protection for sensitive sessions
3. **Session Expiration:** Sessions can be configured to expire automatically
4. **Network Isolation:** Binding to `127.0.0.1` provides maximum isolation
5. **Firewall Rules:** Ensure firewall is configured appropriately
6. **HTTPS/WSS:** For production, consider using WSS (WebSocket Secure) with TLS

## Future Enhancements

1. **Automatic Tunneling Integration:** Direct integration with ngrok, localtunnel, or Cloudflare Tunnel
2. **Automatic IP Detection:** Auto-detect and display network IP in share URLs
3. **WSS Support:** Secure WebSocket connections with TLS
4. **Cloud Relay Service:** Optional Tlink cloud service for internet sharing without configuration
5. **UPnP/NAT Traversal:** Automatic port forwarding configuration

## Troubleshooting

### Cannot connect from other devices
- **Check firewall:** Ensure the port is not blocked
- **Verify IP address:** Use `ifconfig` or `ipconfig` to find correct IP
- **Check network:** Ensure devices are on the same network
- **Try ping:** Verify network connectivity between devices

### Cannot connect from internet
- **Check router port forwarding:** Ensure port is forwarded correctly
- **Check firewall:** Both machine and router firewalls must allow the port
- **Verify public IP:** Ensure you're using the correct public IP address
- **Consider tunneling:** Use a tunneling service for easier setup

### Port already in use
- The server auto-assigns ports, but if a specific port is configured and in use:
- Change the port in configuration
- Or free up the port

## Example Shareable URLs

### Local Network
```
ws://192.168.1.100:54321/session?sessionId=abc123&token=xyz789
```

### Internet (via Port Forwarding)
```
ws://203.0.113.50:54321/session?sessionId=abc123&token=xyz789
```

### Internet (via Tunneling)
```
wss://abc123.ngrok.io/session?sessionId=abc123&token=xyz789
```

## Summary

- **Local Network:** Default configuration works out of the box
- **Internet Access:** Requires port forwarding or tunneling service
- **Security:** Always use tokens, passwords, and expiration for shared sessions
- **Future:** Cloud relay service will simplify internet sharing

