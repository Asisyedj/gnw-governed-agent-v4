"""MPyC functional smoke test for the GNW security lab.

Run: python mpyc_sum_smoke.py -M3 --no-log
Warning: when all parties run on one machine this tests only functionality,
not independent trust domains or hardware-backed attestation.
"""
from mpyc.runtime import mpc


async def main() -> None:
    await mpc.start()
    secint = mpc.SecInt(32)
    shares = mpc.input(secint(mpc.pid + 1))
    total = mpc.sum(shares)
    result = await mpc.output(total)
    expected = len(mpc.parties) * (len(mpc.parties) + 1) // 2
    if mpc.pid == 0:
        status = "PASS" if result == expected else "FAIL"
        print(
            f"GNW_MPC_SELFTEST={status}; parties={len(mpc.parties)}; "
            f"expected={expected}; result={result}"
        )
    await mpc.shutdown()


if __name__ == "__main__":
    mpc.run(main())
