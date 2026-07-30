"use client"

import Seo from "@/shared/layout-components/seo/seo"
import React, { Fragment, useEffect, useMemo, useState } from "react"

import { useConnectedAddress } from "../useConnectedAddress"
import { AdminPortal } from "./components/AdminPortal"
import { InvestorPortal } from "./components/InvestorPortal"
import { Notice } from "./components/ui"
import { explorerAddress, STAKING_CONTRACTS } from "./lib/config"
import { shortAddress } from "./lib/math"
import { usePortal } from "./lib/usePortal"

type View = "investor" | "admin"

export default function SelfStakingPage() {
  const { address, shortAddress: short } = useConnectedAddress()
  const [view, setView] = useState<View>("investor")

  // Admin extras (log scans) only load once the admin view is opened.
  const data = usePortal({ withAdminData: view === "admin" })

  const canSeeAdmin = useMemo(
    () => STAKING_CONTRACTS.some((contract) => data.roles[contract.kind]?.isManager || data.roles[contract.kind]?.isAdmin),
    [data.roles]
  )

  useEffect(() => {
    if (view === "admin" && !canSeeAdmin && !data.loading) setView("investor")
  }, [view, canSeeAdmin, data.loading])

  return (
    <Fragment>
      <Seo title="Self staking" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-xl font-semibold">Self staking</h4>
          <p className="text-sm text-textmuted">
            $BTG staking on Base, served straight from the{" "}
            <a
              href={explorerAddress(STAKING_CONTRACTS[0].address)}
              target="_blank"
              rel="noreferrer"
              className="text-primary"
            >
              staking contracts
            </a>{" "}
            — no third party portal in between.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {address ? (
            <span className="rounded-md bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
              {short || shortAddress(address)}
            </span>
          ) : null}
          {canSeeAdmin ? (
            <div className="flex rounded-md bg-primary/10 p-1">
              <ViewTab label="Investor" active={view === "investor"} onClick={() => setView("investor")} />
              <ViewTab label="Admin" active={view === "admin"} onClick={() => setView("admin")} />
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void data.refresh(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary"
          >
            <i className={`ri-refresh-line ${data.refreshing ? "animate-spin" : ""}`}></i>
            Refresh
          </button>
        </div>
      </div>

      {data.error ? (
        <div className="mb-4">
          <Notice tone="danger">{data.error}</Notice>
        </div>
      ) : null}

      {view === "admin" && canSeeAdmin ? <AdminPortal data={data} /> : <InvestorPortal data={data} />}
    </Fragment>
  )
}

function ViewTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-4 py-1.5 text-xs font-semibold transition ${
        active ? "bg-primary text-white" : "text-primary"
      }`}
    >
      {label}
    </button>
  )
}
