from __future__ import annotations

import asyncio
import os
import random
import re
from typing import Any
from urllib.parse import urlparse

from app.errors.codes import ErrorCode
from app.errors.exceptions import NonRetryableBatcherError, RetryableBatcherError
from app.providers.base import NormalizedAccount, ProviderAdapter, ProviderResult

OUTLOOK_CREATE_URL = "https://outlook.live.com/mail/?prompt=create_account"

class OutlookProviderAdapter(ProviderAdapter):
    name = "outlook"

    async def parse_account(self, raw_line: str) -> NormalizedAccount:
        # Expect email|password
        parts = raw_line.strip().split("|")
        if len(parts) >= 2:
            email = parts[0].strip()
            password = parts[1].strip()
        else:
            email = raw_line.strip()
            password = ""
        return NormalizedAccount(
            provider=self.name, identifier=email, secret=password, raw=raw_line
        )

    async def bootstrap_session(self, account: NormalizedAccount) -> Any:
        try:
            from browserforge.fingerprints import Screen
            from camoufox.async_api import AsyncCamoufox

            camoufox_kwargs: dict[str, Any] = {
                "headless": os.getenv("BATCHER_CAMOUFOX_HEADLESS", "true").lower() == "true",
                "os": "windows",
                "block_webrtc": True,
                "humanize": True,
                "screen": Screen(max_width=1920, max_height=1080),
            }
            proxy_url = os.getenv("BATCHER_PROXY_URL", "")
            if proxy_url:
                parsed = urlparse(proxy_url)
                proxy_cfg: dict[str, Any] = {"server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"}
                if parsed.username:
                    proxy_cfg["username"] = parsed.username
                if parsed.password:
                    proxy_cfg["password"] = parsed.password
                camoufox_kwargs["proxy"] = proxy_cfg
                camoufox_kwargs["geoip"] = True

            manager = AsyncCamoufox(**camoufox_kwargs)
            browser = await manager.__aenter__()
            page = await browser.new_page()
            page.set_default_timeout(30000)

            await page.goto(OUTLOOK_CREATE_URL, wait_until="networkidle", timeout=45000)
            await asyncio.sleep(2)

            return {
                "manager": manager,
                "browser": browser,
                "page": page,
            }
        except Exception as exc:
            raise RetryableBatcherError(
                ErrorCode.browser_start_failed,
                str(exc) or "outlook bootstrap failed",
            ) from exc

    async def authenticate(self, account: NormalizedAccount, session: Any) -> dict[str, Any]:
        if session is None:
            return {"success": False, "error": "No session"}

        page = session["page"]

        try:
            # 1. Entering new email (without domain or username part)
            email_part = account.identifier.split("@")[0]
            # Strip any numbers if the user wants "just name gk ada angka"
            email_part = re.sub(r'\d+', '', email_part)
            if not email_part:
                # Fallback to random name
                email_part = "".join(random.choices("abcdefghijklmnopqrstuvwxyz", k=8))

            await page.wait_for_selector('input[type="email"], input[id="usernameInput"], input[name="username"]', timeout=30000)
            email_input = await page.query_selector('input[type="email"], input[id="usernameInput"], input[name="username"]')
            if email_input:
                await email_input.fill(email_part)
                await asyncio.sleep(1)
            else:
                raise Exception("Email input not found")

            # Click next button: data-testid="primaryButton"
            await page.click('button[data-testid="primaryButton"], button[type="submit"], input[type="submit"]')
            await asyncio.sleep(2)

            # 2. Entering password
            await page.wait_for_selector('input[type="password"], input[id="passwordInput"], input[name="password"]', timeout=15000)
            pass_input = await page.query_selector('input[type="password"], input[id="passwordInput"], input[name="password"]')
            if pass_input:
                await pass_input.fill(account.secret)
                await asyncio.sleep(1)
            else:
                raise Exception("Password input not found")

            # Click next button: data-testid="primaryButton"
            await page.click('button[data-testid="primaryButton"], button[type="submit"], input[type="submit"]')
            await asyncio.sleep(2)

            # 3. Birth details (Country, Month, Day, Year)
            await page.wait_for_selector('[data-testid="countryDropdown"], select[name="countryDropdownName"]', timeout=15000)
            
            birth_month_val = str(random.randint(1, 12))
            birth_day_val = str(random.randint(1, 28))
            birth_year_val = str(random.randint(1990, 2002))
            
            months_names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
            birth_month_name = months_names[int(birth_month_val) - 1]

            # Helper to click custom Microsoft Dropdown/Combobox and select value
            async def select_fluent_dropdown(button_selector: str, option_text: str):
                await page.click(button_selector)
                await asyncio.sleep(1)
                try:
                    await page.wait_for_selector('[role="option"], [role="listbox"]', timeout=5000)
                    options = await page.query_selector_all('[role="option"], [role="listitem"]')
                    for opt in options:
                        text = await opt.inner_text()
                        if option_text.lower() == text.strip().lower() or option_text.lower() in text.lower():
                            await opt.click()
                            return
                except Exception:
                    pass
                await page.click(f'text="{option_text}"')

            # Select BirthMonth custom dropdown
            try:
                await select_fluent_dropdown('#BirthMonthDropdown, button[name="BirthMonth"]', birth_month_name)
            except Exception as e:
                try:
                    await page.select_option('select[name="BirthMonth"]', label=birth_month_name)
                except Exception:
                    raise Exception(f"Failed to select Birth Month: {e}")

            await asyncio.sleep(1)

            # Select BirthDay custom dropdown
            try:
                await select_fluent_dropdown('#BirthDayDropdown, button[name="BirthDay"]', birth_day_val)
            except Exception as e:
                try:
                    await page.select_option('select[name="BirthDay"]', value=birth_day_val)
                except Exception:
                    raise Exception(f"Failed to select Birth Day: {e}")

            await asyncio.sleep(1)

            # Type BirthYear
            year_input = await page.query_selector('input[name="BirthYear"], input[type="number"]')
            if year_input:
                await year_input.fill(birth_year_val)
                await asyncio.sleep(1)
            else:
                raise Exception("Birth Year input not found")

            # Click next
            await page.click('button[data-testid="primaryButton"], button[type="submit"]')
            await asyncio.sleep(2)

            # 4. First Name & Last Name (NameCollection)
            await page.wait_for_selector('input[id="firstNameInput"], input[name="firstNameInput"]', timeout=15000)
            
            # Random Indonesian names
            first_names = ["Budi", "Agus", "Dewi", "Siti", "Rian", "Adit", "Putra", "Rini", "Hendra", "Mega"]
            last_names = ["Saputra", "Wijaya", "Kusuma", "Santoso", "Pratama", "Lestari", "Hidayat", "Setiawan"]
            first_name = random.choice(first_names)
            last_name = random.choice(last_names)

            await page.fill('input[id="firstNameInput"]', first_name)
            await asyncio.sleep(0.5)
            await page.fill('input[id="lastNameInput"]', last_name)
            await asyncio.sleep(0.5)

            # Click next
            await page.click('button[data-testid="primaryButton"], button[type="submit"]')
            await asyncio.sleep(5)

            # 5. Handle CAPTCHA / Redirect
            success = False
            for _ in range(120): # Wait up to 3 minutes for user to solve CAPTCHA and redirect
                current_url = page.url
                if "outlook.live.com/mail" in current_url or "outlook.office.com" in current_url:
                    success = True
                    break
                await asyncio.sleep(1.5)

            if not success:
                raise Exception("Registration timed out or failed (did not reach mailbox)")

            return {
                "success": True,
                "first_name": first_name,
                "last_name": last_name,
                "birth_day": birth_day_val,
                "birth_month": birth_month_val,
                "birth_year": birth_year_val,
                "email": account.identifier,
            }

        except Exception as e:
            raise NonRetryableBatcherError(
                ErrorCode.auth_failed,
                str(e) or "outlook account creation failed"
            )

    async def fetch_tokens(self, account: NormalizedAccount, auth_state: dict[str, Any], session: Any) -> dict[str, str]:
        # Return registered data as tokens so the server can save them
        return {
            "first_name": auth_state.get("first_name", ""),
            "last_name": auth_state.get("last_name", ""),
            "birth_day": auth_state.get("birth_day", ""),
            "birth_month": auth_state.get("birth_month", ""),
            "birth_year": auth_state.get("birth_year", ""),
            "registered_email": account.identifier,
        }

    async def fetch_quota(self, account: NormalizedAccount, tokens: dict[str, str], session: Any) -> dict[str, Any] | None:
        return {
            "remaining_credits": 15.0,
            "total_credits": 15.0,
        }

    async def cleanup_session(self, session: Any) -> None:
        if session and "manager" in session:
            try:
                await session["manager"].__aexit__(None, None, None)
            except Exception:
                pass
