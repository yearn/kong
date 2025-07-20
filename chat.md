> murderteeth:
yes its confusing! v2 is apiVersion = .4.x and v3 is apiVersion = 3.x.x

> murderteeth:
not sure what you mean. but yes this another historic pps delta apy. we already have this in kong

> murderteeth:
i'm realizing we got off track, that's my fault

> murderteeth:
lets go back.. the original issue is here, https://github.com/yearn/kong/issues/227

> murderteeth:
all we want in this pr is the fwdapy for curve vaults. the logic for those starts here,
https://github.com/yearn/ydaemon/blob/main/processes/apr/main.go#L131

> murderteeth:
the other logic in main.go is not nessesary

> murderteeth:
do you think we can cut everything else?

> murderteeth:
or maybe put everything else in another branch

> murderteeth:
but tbh the code in ydaemon is not great. i *dont* want an identical copy of all the ydaemon apy code ported from go to ts

> murderteeth:
better would be to do a peice first (fwd crv), then figure what to port next and how we want to do it based on what we learn. this is important bc there will be new fwd aprs we need to add in the future and we want a good roadmap\template for doing that. ie, do it the "kong" way, not the ydaemon way

> murderteeth:
in my mind we end up with sth like this


ingest/abi/yearn/lib/apr/fwd/crv/..code and tests
ingest/abi/yearn/2/vault/timeseries/hook.ts (contains if (isCurveVault) call apr/fwd/crv)
ingest/abi/yearn/2/vault/snapshot/hook.ts (add apr/fwd/crv to snapshot)
web/app/api/gql/typedef changes

> murderteeth:
(tbh, i haven't read the code close enough to know if these are APRs or APYs. ydaemon code gets a lot of naming conventions wrong. what i understand now is that usually if its fwd-looking it's APR (hasn't been compounded). when its historic its APY (has been compounded))

> murderteeth:
honestly dont have time to write issues now. but i dnt think you need to worry about diff between v2 and v3.. for this case, the curve fwd apy\apr we'll mirror the logic in ydaemon

> murderteeth:
from what i see in main.go, it looksl ike isCurveVault is called on both v2 and v3 vaults.. so guessing that code either handled both v2 and v3 or isCurveVault is only ever true for v2 vaults

> murderteeth:
in fact i'm pretty sure this is the case

> murderteeth:
just because we dont have v3 curve vaults

> murderteeth:
🖼 dnt remember why this is exactly. but yeah our curve people had a reason not to migrate to v3
