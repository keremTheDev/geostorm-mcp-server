import json
import subprocess
import time

def test_node_mcp():
    print("🚀 Node.js süreci başlatılıyor...")
    
    # Node.js sürecini doğrudan absolute path ile spawn ediyoruz
    process = subprocess.Popen(
        ["node", "dist/index.js"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1
    )
    
    # Sunucunun kendine gelmesi için yarım saniye bekle
    time.sleep(0.5)

    # Resmi JSON-RPC 2.0 / MCP Protokol formatında istek paketi
    # get_coronal_mass_ejections tool'unu tetikliyoruz
    mcp_request = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "id": "test-1",
        "params": {
            "name": "get_coronal_mass_ejections",
            "arguments": {
                "startDate": "2026-05-01",
                "endDate": "2026-05-05"
            }
        }
    }

    try:
        print("📡 İstek MCP Server'a (stdin) gönderiliyor...")
        # JSON paketini tek bir satır olarak gönderip arkasından flush ediyoruz
        payload = json.dumps(mcp_request) + "\n"
        process.stdin.write(payload)
        process.stdin.flush()

        print("⏳ Yanıt bekleniyor (stdout)...")
        # Node.js tarafının ürettiği yanıtı satır satır okuyoruz
        response_line = process.stdout.readline()
        
        if response_line:
            print("\n✅ BAŞARILI! MCP Server'dan ham yanıt geldi:")
            parsed_response = json.loads(response_line)
            print(json.dumps(parsed_response, indent=2, ensure_ascii=False))
        else:
            print("❌ Sunucu boş yanıt döndü. Stderr kontrol ediliyor...")
            print("Stderr:", process.stderr.readline())

    except Exception as e:
        print(f"❌ Test sırasında hata oluştu: {e}")
    finally:
        process.terminate()

if __name__ == "__main__":
    test_node_mcp()