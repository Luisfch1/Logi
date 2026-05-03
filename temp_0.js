
      // Enhanced early debug for bridge detection
      console.log("DEBUG: index.html start:", { 
        capacitor: !!window.Capacitor, 
        platform: window.Capacitor?.getPlatform() || 'unknown',
        adapter: !!window.LogiNative
      });
      window.onerror = function(msg, url, line, col, error) {
        console.error("CRITICAL ERROR:", msg, "at", line, "err:", error);
        // Special case: if error is about storage but we are on native, it's a bridge lag
        if (msg.includes("LogiNative") && window.Capacitor?.getPlatform() !== 'web') {
           console.warn("Retrying initialization due to bridge lag...");
           return true; 
        }
        alert("ERROR: " + msg + "\n(" + line + ")");
        return false;
      };
    