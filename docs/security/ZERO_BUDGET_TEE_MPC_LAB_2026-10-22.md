# Zero-Budget GNW TEE/MPC Lab — 2026-10-22

## Scope and claims

This is a development/verification lab for the GNW local server. It is not yet a production TEE attestation chain.

| Component | Current observation | What it proves |
|---|---|---|
| Android phone "localhost" | Android kernel + Ubuntu 26.04.1 PRoot, ARM64; no visible /dev/tpm* or /dev/tee*; PRoot root is not kernel root | Usable Python/MPC development environment, not a hardware attestor |
| Windows 11 "asisyedj" | Build 26100.4770; native tpmtool getdeviceinformation failed with 0x800710df ("device is not ready"); WSL distro is Ubuntu WSL 1 | Windows TPM is not currently available to this session; WSL is not a hardware attestor |
| GNW application | npm run build ran server TypeScript build and Vite client build; Vite reported 33 modules transformed and built | Build output appears successful; this alone is not full test or production deployment |
| MPyC on phone | Installed in /root/gnw-security-lab/.venv; 3-party sample returned GNW_MPC_SELFTEST=PASS; parties=3; expected=6; result=6 | Functional secret-sharing protocol smoke test only; all parties ran on one phone |
| Actual OP-TEE/QEMU, swtpm/Keylime, cross-device malicious-secure MPC | Not yet verified in this session | No production-attestation claim permitted |

## Selected stack (zero software-license cost)

1. OP-TEE on QEMU v8 to exercise trusted-application APIs and learn the lifecycle in a reproducible simulator. Use OP-TEE, not the legacy Open-TEE virtual TEE, for a new lab. QEMU/TCG is simulation and must not be treated as a handset TrustZone quote or production measurement.
2. swtpm + tpm2-tools to test TPM 2.0 commands and Keylime’s development workflow without actual TPM hardware. This is software-emulated TPM only.
3. Keylime as the TPM-backed measured-boot/IMA verifier integration. Its production claim requires an authentic root of trust, normally hardware TPM 2.0 plus a supported Linux agent/IMA environment; a vTPM does not create hardware trust.
4. MP-SPDZ (preferred for the two-machine malicious-security experiment) instead of legacy CrypTen or ABY3. MPyC is already installed as a small Python functional test. MPyC's passively-secure semi-honest model and the same-host smoke test are not equivalent to maliciously secure independent MPC signers.
5. GNW remains fail-closed until a genuine attestation provider/hardware quote and independently held MPC signing keys/quorum are configured and verified.

## Sources

- OP-TEE QEMU v8 setup: https://optee.readthedocs.io/en/latest/building/devices/qemu.html
- Open-TEE project description (legacy virtual TEE): https://github.com/Open-TEE/project
- Keylime documentation: https://keylime.readthedocs.io/en/latest/
- swtpm software TPM emulator: https://github.com/stefanberger/swtpm
- MP-SPDZ: https://github.com/data61/MP-SPDZ
- MPyC: https://github.com/lschoe/mpyc
- CrypTen archived May 2025: https://github.com/facebookresearch/CrypTen
- ABY3 warning and MP-SPDZ recommendation: https://github.com/ladnir/aby3
- Microsoft VBS Enclave prerequisites: https://learn.microsoft.com/en-us/windows/win32/trusted-execution/vbs-enclaves
- Windows TPM diagnostic command: https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/tpmtool

## A. Phone: MPyC functional check already run

Environment: Ubuntu 26.04.1 PRoot on ARM64 Android. Project location: /root/gnw-security-lab.

    python3 -m venv "$HOME/gnw-security-lab/.venv"
    "$HOME/gnw-security-lab/.venv/bin/python" -m pip install --upgrade pip
    "$HOME/gnw-security-lab/.venv/bin/python" -m pip install mpyc
    "$HOME/gnw-security-lab/.venv/bin/python" "$HOME/gnw-security-lab/mpyc_sum.py" -M3 --no-log

Recorded result: GNW_MPC_SELFTEST=PASS; parties=3; expected=6; result=6.

Limit: all three processes belong to the same phone/owner. This proves functionality only, not separation of trust, remote attestation, or resilience against a malicious participant.

## B. Windows 11: hardware check

Run from an elevated PowerShell only if authorized and available:

    tpmtool getdeviceinformation
    Get-Tpm | Format-List TpmPresent,TpmReady,TpmEnabled,TpmActivated,ManufacturerIdTxt,ManufacturerVersion
    Confirm-SecureBootUEFI
    Get-CimInstance -Namespace root\Microsoft\Windows\DeviceGuard -ClassName Win32_DeviceGuard |
      Select-Object VirtualizationBasedSecurityStatus,SecurityServicesConfigured,SecurityServicesRunning
    wsl --list --verbose

Observed TPM command error: 0x800710df - The device is not ready for use. Do not bypass the error or replace this output with emulator evidence. Check firmware/UEFI TPM (Intel PTT / AMD fTPM), Windows Security > Device security > Security processor, and OEM firmware updates with the machine owner. Do not clear/reset the TPM casually: that can affect BitLocker or other protected keys. WSL currently reports Ubuntu Version 1; WSL TPM/device passthrough must not be assumed.

Windows has a VBS Enclave route in principle (this OS build is above the documented minimum), but it additionally requires VBS/HVCI enabled, Visual Studio 2022 17.9+, Windows SDK 10.0.22621.3233+, and a Trusted Signing account. It is not yet configured or attested here.

## C. Windows WSL Ubuntu: OP-TEE QEMU v8 (SIMULATOR ONLY)

After the WSL package installation finishes, check repo --version, git --version, make --version and disk availability. Then:

    mkdir -p "$HOME/gnw-security-lab/optee-qemu"
    cd "$HOME/gnw-security-lab/optee-qemu"
    repo init -u https://github.com/OP-TEE/manifest.git -m qemu_v8.xml
    repo sync -j4
    cd build
    make toolchains
    make run

This is a full source build and may take substantial download/build time. Keep it in WSL filesystem (not /mnt/d) for I/O efficiency. If WSL1 causes QEMU or build problems, upgrade the Ubuntu distro to WSL2 only after backup and admin approval; WSL2 still does not itself turn QEMU into a hardware TEE. Record the QEMU console/normal boot and sample Trusted Application test in the report before treating this stage as passed.

## D. Windows WSL Ubuntu: software TPM + TPM 2 tools (DEVELOPMENT ONLY)

After the package manager is idle and swtpm, swtpm_setup, tpm2_startup, tpm2_getcap exist:

    install -d -m 700 "$HOME/gnw-security-lab/swtpm-state"
    swtpm socket --tpm2 \
      --tpmstate dir="$HOME/gnw-security-lab/swtpm-state" \
      --server type=tcp,port=2321,bindaddr=127.0.0.1 \
      --ctrl type=tcp,port=2322,bindaddr=127.0.0.1 \
      --flags startup-clear

In a second WSL terminal (TCTI syntax varies with the installed build; verify the configured TCTI driver with tpm2_getcap --help and the swtpm package docs):

    export TPM2TOOLS_TCTI="swtpm:host=127.0.0.1,port=2321"
    tpm2_startup -c
    tpm2_getcap properties-fixed
    tpm2_pcrread sha256:0,1,2,7

If the installed tpm2-tools build only accepts the Microsoft simulator TCTI for the chosen swtpm mode, use the Keylime-documented simulator TCTI and matching server mode rather than turning off checks. Do not bind emulator ports to the LAN. A passing vTPM command is not a genuine device identity or a production root-of-trust measurement.

Keylime may then be evaluated for an entirely local lab. First establish its current installation and agent/verifier configuration from its official latest docs. A WSL1 kernel may not provide the Linux IMA/measured-boot enforcement that a useful production Keylime agent needs. Do not claim an end-to-end Keylime PASS until enrollment, quote verification, policy measurement and a negative/tamper test all succeed. Never rely on swtpm for production.

## E. Real two-machine MPC (target after lab tools are installed)

Use MP-SPDZ MASCOT for the first malicious-security protocol demo. Official repo instructions include:

    git clone https://github.com/data61/MP-SPDZ.git
    cd MP-SPDZ
    make -j4 mascot-party.x

For a first local test, follow the current repo's exact install/tutorial instructions and run its two-party tutorial. For cross-device testing, first prove phone 192.168.100.28 and Windows 192.168.100.27 can mutually reach a deliberately opened test port, configure authenticated SSH/certificates, bind MPC to the private Wi-Fi address, restrict Windows Firewall to the single phone IP and chosen TCP port (MP-SPDZ commonly uses ports around 5000), then run one party per machine and verify both logs and output. Do not open router/WAN ports and do not place real signing keys in the test. MP-SPDZ may be resource-intensive on phone/PRoot; if it will not build on ARM64, use Windows/WSL as one party only while labeling any co-located party simulation accordingly.

Before any WAN access, replace LAN endpoints with authenticated HTTPS/VPN links and explicit peer identity checks. A same-router setup is a two-node experiment, not independent organizational trust, if both devices are administered by one person.

## F. GNW release and production gates

- Keep DATABASE_URL, executor credentials, LLM keys and production evidence in local secret storage; never check them into Git.
- Sign the exact release commit/artifact digest, runtime measurement, unique nonce and fresh timestamp; verifier must enforce binding, expiry, replay prevention and trust-root validation.
- Use 2-of-3 (or a formally chosen) threshold only if the private signing shares are held by genuinely separate participants/trust domains. Do not call three local processes an independent quorum.
- Test a deliberately stale quote, wrong measurement, wrong artifact hash, replayed nonce, bad signature and insufficient quorum; each must DENY.
- Run GNW full tests, release metadata gate, production preflight, DB migration dry-run/backup and local health/API smoke tests. Deploy only after every gate passes.
- At this report's initial writing, MPyC functional smoke test and GNW build output were observed, but OP-TEE/QEMU build, swtpm/Keylime integration, cross-device MPC, real TPM/TEE and independent signer quorum were not yet verified. Update this file with exact logs and exit codes before changing the status.
