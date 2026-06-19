KEYFILE_PATH="./keyfile"

openssl rand -base64 756 > "$KEYFILE_PATH"
chmod 400 "$KEYFILE_PATH"

echo "Keyfile generated at $KEYFILE_PATH"
echo "Copy this file to all 3 VMs before running the mongodb"
