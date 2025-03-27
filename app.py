import asyncio
import base64
import json
import os
import threading
import tomllib
import uuid
import webbrowser
from datetime import datetime
from functools import partial
from json import dumps
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.websockets import WebSocket, WebSocketDisconnect

# Import Playwright related modules
from playwright.async_api import async_playwright
from pydantic import BaseModel


# Add global variable to store browser sessions
browser_sessions = {}

# Add a dictionary to store task and agent associations
task_agents = {}

app = FastAPI()

app.mount("/static", StaticFiles(directory="web/static"), name="static")
templates = Jinja2Templates(directory="web/templates")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Task(BaseModel):
    id: str
    prompt: str
    created_at: datetime
    status: str
    steps: list = []

    def model_dump(self, *args, **kwargs):
        data = super().model_dump(*args, **kwargs)
        data["created_at"] = self.created_at.isoformat()
        return data


class TaskManager:
    def __init__(self):
        self.tasks = {}
        self.queues = {}

    def create_task(self, prompt: str) -> Task:
        task_id = str(uuid.uuid4())
        task = Task(
            id=task_id, prompt=prompt, created_at=datetime.now(), status="pending"
        )
        self.tasks[task_id] = task
        self.queues[task_id] = asyncio.Queue()
        return task

    async def update_task_step(
        self, task_id: str, step: int, result: str, step_type: str = "step"
    ):
        if task_id in self.tasks:
            task = self.tasks[task_id]
            task.steps.append({"step": step, "result": result, "type": step_type})
            await self.queues[task_id].put(
                {"type": step_type, "step": step, "result": result, "taskId": task_id}
            )
            await self.queues[task_id].put(
                {"type": "status", "status": task.status, "steps": task.steps}
            )

    async def complete_task(self, task_id: str):
        if task_id in self.tasks:
            task = self.tasks[task_id]
            task.status = "completed"
            await self.queues[task_id].put(
                {"type": "status", "status": task.status, "steps": task.steps}
            )
            await self.queues[task_id].put({"type": "complete"})

    async def fail_task(self, task_id: str, error: str):
        if task_id in self.tasks:
            self.tasks[task_id].status = f"failed: {error}"
            await self.queues[task_id].put({"type": "error", "message": error})


task_manager = TaskManager()


def get_available_themes():
    """Scan themes directory to get all available themes"""
    themes_dir = "web/static/themes"
    if not os.path.exists(themes_dir):
        return [{"id": "openmanus", "name": "Manus", "description": "Default theme"}]

    themes = []
    for item in os.listdir(themes_dir):
        theme_path = os.path.join(themes_dir, item)
        if os.path.isdir(theme_path):
            # Verify if the theme folder contains necessary files
            templates_dir = os.path.join(theme_path, "templates")
            static_dir = os.path.join(theme_path, "static")
            config_file = os.path.join(theme_path, "theme.json")

            if os.path.exists(templates_dir) and os.path.exists(static_dir):
                if os.path.exists(os.path.join(templates_dir, "chat.html")):
                    theme_info = {"id": item, "name": item, "description": ""}

                    # If there is a configuration file, read the theme name and description
                    if os.path.exists(config_file):
                        try:
                            with open(config_file, "r", encoding="utf-8") as f:
                                config = json.load(f)
                                theme_info["name"] = config.get("name", item)
                                theme_info["description"] = config.get(
                                    "description", ""
                                )
                        except Exception as e:
                            print(f"Error reading theme configuration file: {str(e)}")

                    themes.append(theme_info)

    # Ensure Normal theme always exists
    normal_exists = any(theme["id"] == "openmanus" for theme in themes)
    if not normal_exists:
        themes.append(
            {"id": "openmanus", "name": "Manus", "description": "Default theme"}
        )

    return themes


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    # Get available theme list
    themes = get_available_themes()

    # Sort themes: Normal first, cyberpunk second, other themes in original order
    sorted_themes = []
    normal_theme = None
    cyberpunk_theme = None
    other_themes = []

    for theme in themes:
        if theme["id"] == "openmanus":
            normal_theme = theme
        elif theme["id"] == "cyberpunk":
            cyberpunk_theme = theme
        else:
            other_themes.append(theme)

    # Combine themes in specified order
    if normal_theme:
        sorted_themes.append(normal_theme)
    if cyberpunk_theme:
        sorted_themes.append(cyberpunk_theme)
    sorted_themes.extend(other_themes)

    return templates.TemplateResponse(
        "index.html", {"request": request, "themes": sorted_themes}
    )


@app.get("/chat", response_class=HTMLResponse)
async def chat(request: Request):
    theme = request.query_params.get("theme", "openmanus")
    # Try to load chat.html from theme folder
    theme_chat_path = f"web/static/themes/{theme}/templates/chat.html"
    if os.path.exists(theme_chat_path):
        with open(theme_chat_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Read theme configuration file
        theme_config_path = f"web/static/themes/{theme}/theme.json"
        theme_name = theme
        if os.path.exists(theme_config_path):
            try:
                with open(theme_config_path, "r", encoding="utf-8") as f:
                    config = json.load(f)
                    theme_name = config.get("name", theme)
            except Exception:
                pass

        # Add theme name to HTML title
        content = content.replace(
            "<title>Manus</title>", f"<title>Manus - {theme_name}</title>"
        )
        return HTMLResponse(content=content)
    else:
        # Default use templates chat.html
        return templates.TemplateResponse("chat.html", {"request": request})


@app.get("/download")
async def download_file(file_path: str):
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(file_path, filename=os.path.basename(file_path))


@app.post("/tasks")
async def create_task(prompt: str = Body(..., embed=True)):
    task = task_manager.create_task(prompt)
    asyncio.create_task(run_task(task.id, prompt))
    return {"task_id": task.id}


from app.agent.manus import Manus


async def run_task(task_id: str, prompt: str):
    try:
        task_manager.tasks[task_id].status = "running"

        agent = Manus(
            name="Manus",
            description="A versatile agent that can solve various tasks using multiple tools",
        )

        # Save the association between task and agent
        task_agents[task_id] = agent

        async def on_think(thought):
            await task_manager.update_task_step(task_id, 0, thought, "think")

        async def on_tool_execute(tool, input):
            await task_manager.update_task_step(
                task_id, 0, f"Executing tool: {tool}\nInput: {input}", "tool"
            )

        async def on_action(action):
            await task_manager.update_task_step(
                task_id, 0, f"Executing action: {action}", "act"
            )

        async def on_run(step, result):
            await task_manager.update_task_step(task_id, step, result, "run")

        from app.logger import logger

        class SSELogHandler:
            def __init__(self, task_id):
                self.task_id = task_id

            async def __call__(self, message):
                import re

                # Extract - Subsequent Content
                cleaned_message = re.sub(r"^.*? - ", "", message)

                event_type = "log"
                if "✨ Manus's thoughts:" in cleaned_message:
                    event_type = "think"
                elif "🛠️ Manus selected" in cleaned_message:
                    event_type = "tool"
                elif "🎯 Tool" in cleaned_message:
                    event_type = "act"
                elif "📝 Oops!" in cleaned_message:
                    event_type = "error"
                elif "🏁 Special tool" in cleaned_message:
                    event_type = "complete"

                await task_manager.update_task_step(
                    self.task_id, 0, cleaned_message, event_type
                )

        sse_handler = SSELogHandler(task_id)
        logger.add(sse_handler)

        result = await agent.run(prompt)
        await task_manager.update_task_step(task_id, 1, result, "result")
        await task_manager.complete_task(task_id)
    except Exception as e:
        await task_manager.fail_task(task_id, str(e))
    finally:
        # Keep the agent instance for a while after task completion so frontend can view browser content
        # A timer task can be set here to clean up expired agent instances
        pass


@app.get("/tasks/{task_id}/events")
async def task_events(task_id: str):
    async def event_generator():
        if task_id not in task_manager.queues:
            yield f"event: error\ndata: {dumps({'message': 'Task not found'})}\n\n"
            return

        queue = task_manager.queues[task_id]

        task = task_manager.tasks.get(task_id)
        if task:
            yield f"event: status\ndata: {dumps({'type': 'status', 'status': task.status, 'steps': task.steps})}\n\n"

        while True:
            try:
                event = await queue.get()
                formatted_event = dumps(event)

                yield ": heartbeat\n\n"

                if event["type"] == "complete":
                    yield f"event: complete\ndata: {formatted_event}\n\n"
                    break
                elif event["type"] == "error":
                    yield f"event: error\ndata: {formatted_event}\n\n"
                    break
                elif event["type"] == "step":
                    task = task_manager.tasks.get(task_id)
                    if task:
                        yield f"event: status\ndata: {dumps({'type': 'status', 'status': task.status, 'steps': task.steps})}\n\n"
                    yield f"event: {event['type']}\ndata: {formatted_event}\n\n"
                elif event["type"] in ["think", "tool", "act", "run"]:
                    yield f"event: {event['type']}\ndata: {formatted_event}\n\n"
                else:
                    yield f"event: {event['type']}\ndata: {formatted_event}\n\n"

            except asyncio.CancelledError:
                print(f"Client disconnected for task {task_id}")
                break
            except Exception as e:
                print(f"Error in event stream: {str(e)}")
                yield f"event: error\ndata: {dumps({'message': str(e)})}\n\n"
                break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/tasks")
async def get_tasks():
    sorted_tasks = sorted(
        task_manager.tasks.values(), key=lambda task: task.created_at, reverse=True
    )
    return JSONResponse(
        content=[task.model_dump() for task in sorted_tasks],
        headers={"Content-Type": "application/json"},
    )


@app.get("/tasks/{task_id}")
async def get_task(task_id: str):
    if task_id not in task_manager.tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    return task_manager.tasks[task_id]


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500, content={"message": f"Server error: {str(exc)}"}
    )


def open_local_browser(config):
    webbrowser.open_new_tab(f"http://{config['host']}:{config['port']}")


def load_config():
    try:
        config_path = Path(__file__).parent / "config" / "config.toml"

        with open(config_path, "rb") as f:
            config = tomllib.load(f)

        return {"host": config["server"]["host"], "port": config["server"]["port"]}
    except FileNotFoundError:
        raise RuntimeError(
            "Configuration file not found, please check if config/fig.toml exists"
        )
    except KeyError as e:
        raise RuntimeError(
            f"The configuration file is missing necessary fields: {str(e)}"
        )


# Add screenshot API route with live mode option
@app.post("/api/screenshot")
async def get_screenshot(request_data: dict = Body(...)):
    url = request_data.get("url", "")
    use_live_mode = request_data.get("useLiveMode", False)

    try:
        print(f"Getting webpage, URL: {url}, Live mode: {use_live_mode}")

        if use_live_mode:
            # Create live browsing session
            session_id = str(uuid.uuid4())

            # Launch non-headless browser process
            async def create_browser_session():
                playwright_instance = await async_playwright().start()
                browser = await playwright_instance.chromium.launch(
                    args=[
                        "--disable-web-security",
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--remote-debugging-port=0",  # Dynamically assign debug port
                    ],
                    headless=False,  # Non-headless mode
                )

                # Create browser context
                context = await browser.new_context(
                    viewport={"width": 1280, "height": 800},
                    java_script_enabled=True,
                    ignore_https_errors=True,
                )

                # Create page
                page = await context.new_page()

                # Set user agent
                await page.set_extra_http_headers(
                    {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36"
                    }
                )

                # Navigate to specified URL
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    await page.wait_for_load_state("networkidle", timeout=10000)
                except Exception as e:
                    print(f"Navigation error, but continuing: {str(e)}")

                # Get CDP session info
                client = await context.new_cdp_session(page)

                # Fix ws_endpoint property access error
                try:
                    # Try different methods to get WebSocket endpoint
                    if hasattr(browser, "wsEndpoint"):
                        endpoint_url = browser.wsEndpoint
                    elif hasattr(browser, "ws_endpoint"):
                        endpoint_url = browser.ws_endpoint
                    else:
                        # Use this method in newer versions of playwright
                        endpoint_url = browser._channel.guid
                except Exception as e:
                    print(f"Error getting WebSocket endpoint: {str(e)}")
                    endpoint_url = "Unable to get endpoint URL"

                # Save session information
                browser_sessions[session_id] = {
                    "playwright": playwright_instance,
                    "browser": browser,
                    "context": context,
                    "page": page,
                    "client": client,
                    "endpoint_url": endpoint_url,
                    "created_at": datetime.now(),
                    "url": url,
                }

                return {
                    "session_id": session_id,
                    "endpoint_url": endpoint_url,
                    "url": url,
                }

            session_info = await create_browser_session()

            # Return session information
            return JSONResponse(
                content={
                    "success": True,
                    "live_mode": True,
                    "session_id": session_info["session_id"],
                    "endpoint_url": session_info["endpoint_url"],
                    "url": url,
                }
            )
        else:
            # Original screenshot mode logic
            async with async_playwright() as playwright:
                # Browser launch options
                browser = await playwright.chromium.launch(
                    args=[
                        "--disable-web-security",
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                    ],
                    headless=True,
                )

                # Create browser context
                context = await browser.new_context(
                    viewport={"width": 1280, "height": 800},
                    java_script_enabled=True,
                    ignore_https_errors=True,
                )

                # Create page
                page = await context.new_page()

                # Set user agent
                await page.set_extra_http_headers(
                    {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36"
                    }
                )

                try:
                    # Navigate to specified URL
                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)

                    # Wait for page load
                    await page.wait_for_load_state("networkidle", timeout=10000)
                except Exception as e:
                    print(f"Navigation error, but continuing: {str(e)}")

                # Try to get page dimensions
                try:
                    # Get page dimension information
                    page_dimensions = await page.evaluate(
                        """() => {
                        return {
                            width: Math.max(
                                document.body ? document.body.scrollWidth : 0,
                                document.documentElement ? document.documentElement.scrollWidth : 0,
                                window.innerWidth || 0
                            ) || 1280,
                            height: Math.max(
                                document.body ? document.body.scrollHeight : 0,
                                document.documentElement ? document.documentElement.scrollHeight : 0,
                                window.innerHeight || 0
                            ) || 900,
                            windowHeight: window.innerHeight || 900,
                            windowWidth: window.innerWidth || 1280,
                            devicePixelRatio: window.devicePixelRatio || 1
                        }
                    }"""
                    )
                except Exception as e:
                    print(f"Failed to get page dimensions: {str(e)}")
                    page_dimensions = {
                        "width": 1280,
                        "height": 900,
                        "windowHeight": 900,
                        "windowWidth": 1280,
                        "devicePixelRatio": 1,
                    }

                try:
                    # Get screenshot
                    screenshot = await page.screenshot(
                        full_page=True, type="jpeg", quality=95
                    )

                    print(f"Screenshot successful: {len(screenshot)} bytes")

                    # Get webpage title
                    try:
                        title = await page.title()
                    except:
                        title = url

                    # Close browser
                    await browser.close()

                    # Convert to Base64 encoding
                    screenshot_base64 = base64.b64encode(screenshot).decode("utf-8")

                    # Return screenshot data
                    return JSONResponse(
                        content={
                            "success": True,
                            "live_mode": False,
                            "screenshot": screenshot_base64,
                            "url": url,
                            "title": title,
                            "dimensions": page_dimensions,
                            "timestamp": datetime.now().isoformat(),
                        }
                    )
                except Exception as e:
                    # If screenshot fails, ensure browser is closed
                    print(f"Screenshot failed: {str(e)}")
                    await browser.close()
                    raise HTTPException(
                        status_code=500, detail=f"Failed to take screenshot: {str(e)}"
                    )
    except Exception as e:
        print(f"Screenshot service error: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Screenshot service error: {str(e)}"
        )


# Add endpoint to get browser session information
@app.get("/api/browser-session/{session_id}")
async def get_browser_session(session_id: str):
    if session_id not in browser_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = browser_sessions[session_id]
    return {
        "session_id": session_id,
        "endpoint_url": session["endpoint_url"],
        "url": session["url"],
        "created_at": session["created_at"].isoformat(),
    }


# Add endpoint to close browser session
@app.delete("/api/browser-session/{session_id}")
async def close_browser_session(session_id: str):
    if session_id not in browser_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = browser_sessions[session_id]
    try:
        await session["browser"].close()
        await session["playwright"].stop()
        del browser_sessions[session_id]
        return {"message": "Session closed successfully"}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to close session: {str(e)}"
        )


# Regularly clean up expired browser sessions
@app.on_event("startup")
async def setup_session_cleanup():
    async def cleanup_sessions():
        while True:
            await asyncio.sleep(300)  # Check every 5 minutes
            now = datetime.now()
            expired_sessions = []

            for session_id, session in browser_sessions.items():
                # Sessions over 30 minutes are considered expired
                if (now - session["created_at"]).total_seconds() > 1800:
                    expired_sessions.append(session_id)

            for session_id in expired_sessions:
                try:
                    session = browser_sessions[session_id]
                    await session["browser"].close()
                    await session["playwright"].stop()
                    del browser_sessions[session_id]
                    print(f"Expired session cleaned: {session_id}")
                except Exception as e:
                    print(f"Error cleaning session: {session_id}, {str(e)}")

    asyncio.create_task(cleanup_sessions())


# Add browser content real-time forwarding functionality
@app.websocket("/ws/browser/{session_id}")
async def browser_websocket(websocket: WebSocket, session_id: str):
    await websocket.accept()

    if session_id not in browser_sessions:
        await websocket.send_json({"error": "Session does not exist"})
        await websocket.close()
        return

    session = browser_sessions[session_id]
    page = session["page"]

    try:
        # Create channel to forward browser content
        # First send initial page content
        try:
            # Get page HTML content
            html_content = await page.content()
            await websocket.send_json({"type": "content", "html": html_content})

            # Get and send page screenshot for initial display
            screenshot = await page.screenshot(type="jpeg", quality=90)
            screenshot_base64 = base64.b64encode(screenshot).decode("utf-8")
            await websocket.send_json({"type": "screenshot", "data": screenshot_base64})

            # Set up periodic screenshot updates
            while True:
                await asyncio.sleep(0.5)  # Update every 0.5 seconds

                try:
                    # Check if session still exists
                    if session_id not in browser_sessions:
                        break

                    # Get latest screenshot
                    screenshot = await page.screenshot(type="jpeg", quality=80)
                    screenshot_base64 = base64.b64encode(screenshot).decode("utf-8")
                    await websocket.send_json(
                        {"type": "screenshot", "data": screenshot_base64}
                    )

                    # Get page title
                    title = await page.title()
                    await websocket.send_json({"type": "title", "data": title})

                except Exception as e:
                    print(f"Error updating browser content: {str(e)}")
                    break

        except Exception as e:
            await websocket.send_json(
                {"type": "error", "message": f"Error getting page content: {str(e)}"}
            )

    except WebSocketDisconnect:
        print(f"WebSocket connection closed: {session_id}")
    except Exception as e:
        print(f"Browser WebSocket error: {str(e)}")
    finally:
        # Note: Don't close the session here as it may be in use elsewhere
        pass


# Add browser control API
@app.post("/api/browser-action/{session_id}")
async def browser_action(session_id: str, action: dict = Body(...)):
    if session_id not in browser_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = browser_sessions[session_id]
    page = session["page"]
    action_type = action.get("type")

    try:
        if action_type == "click":
            # Click element
            selector = action.get("selector")
            if selector:
                await page.click(selector)
            else:
                x = action.get("x", 0)
                y = action.get("y", 0)
                await page.mouse.click(x, y)
            return {"success": True}

        elif action_type == "scroll":
            # Scroll page
            x = action.get("x", 0)
            y = action.get("y", 0)
            await page.evaluate(f"window.scrollTo({x}, {y})")
            return {"success": True}

        elif action_type == "input":
            # Input text
            selector = action.get("selector")
            text = action.get("text", "")
            if selector:
                await page.fill(selector, text)
            return {"success": True}

        elif action_type == "navigate":
            # Navigate to URL
            url = action.get("url")
            if url:
                await page.goto(url)
            return {"success": True}

        elif action_type == "refresh":
            # Refresh page
            await page.reload()
            return {"success": True}

        else:
            raise HTTPException(
                status_code=400, detail=f"Unsupported operation type: {action_type}"
            )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error executing browser operation: {str(e)}"
        )


# Add API endpoint to get task browser session info
@app.get("/api/tasks/{task_id}/browser")
async def get_task_browser_info(task_id: str):
    # Check if task exists
    if task_id not in task_manager.tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    # Check if there is an associated agent
    if task_id not in task_agents:
        raise HTTPException(
            status_code=404, detail="No agent associated with this task"
        )

    agent = task_agents[task_id]

    # Get browser session info
    browser_info = await agent.get_browser_session_info()
    if not browser_info:
        raise HTTPException(status_code=404, detail="No browser session for this task")

    # Only return safe information
    return {
        "task_id": task_id,
        "has_browser": True,
        "endpoint_url": browser_info["endpoint_url"],
        "initialized": browser_info["initialized"],
    }


# Add WebSocket endpoint to forward browser content in tasks
@app.websocket("/ws/tasks/{task_id}/browser")
async def task_browser_websocket(websocket: WebSocket, task_id: str):
    await websocket.accept()

    # Check if the task exists and has an associated agent
    if task_id not in task_manager.tasks or task_id not in task_agents:
        await websocket.send_json(
            {"error": "Task does not exist or has no associated agent"}
        )
        await websocket.close()
        return

    agent = task_agents[task_id]

    try:
        # Get browser page
        page = await agent.get_active_browser_page()
        if not page:
            await websocket.send_json({"error": "This task has no active browser page"})
            await websocket.close()
            return

        # Start forwarding browser content
        try:
            # Get initial page content
            html_content = await page.content()
            await websocket.send_json({"type": "content", "html": html_content})

            # Get and send initial screenshot
            screenshot = await page.screenshot(type="jpeg", quality=90, full_page=True)
            screenshot_base64 = base64.b64encode(screenshot).decode("utf-8")
            await websocket.send_json({"type": "screenshot", "data": screenshot_base64})

            # Get page title
            title = await page.title()
            await websocket.send_json({"type": "title", "data": title})

            # Send current URL
            url = page.url
            await websocket.send_json({"type": "url", "data": url})

            # Set up periodic screenshot updates
            while True:
                await asyncio.sleep(0.5)  # Update every 0.5 seconds

                try:
                    # Check if task still exists
                    if task_id not in task_agents:
                        break

                    # Get latest screenshot
                    screenshot = await page.screenshot(type="jpeg", quality=80, full_page=True)
                    screenshot_base64 = base64.b64encode(screenshot).decode("utf-8")
                    await websocket.send_json(
                        {"type": "screenshot", "data": screenshot_base64}
                    )

                    # Get page title and URL
                    new_title = await page.title()
                    new_url = page.url

                    # Only send when changes occur
                    if new_title != title:
                        title = new_title
                        await websocket.send_json({"type": "title", "data": title})

                    if new_url != url:
                        url = new_url
                        await websocket.send_json({"type": "url", "data": url})

                except Exception as e:
                    print(f"Error updating task browser content: {str(e)}")
                    break

        except Exception as e:
            await websocket.send_json(
                {"type": "error", "message": f"Error getting page content: {str(e)}"}
            )

    except WebSocketDisconnect:
        print(f"Task browser WebSocket connection closed: {task_id}")
    except Exception as e:
        print(f"Task browser WebSocket error: {str(e)}")
    finally:
        # Don't close the browser session as it may still be in use by the task
        pass


if __name__ == "__main__":
    import uvicorn

    config = load_config()
    open_with_config = partial(open_local_browser, config)
    threading.Timer(3, open_with_config).start()
    uvicorn.run(app, host=config["host"], port=config["port"])
