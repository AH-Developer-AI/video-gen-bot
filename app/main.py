# main.py

import os
import base64
import uuid
import json
import re
import subprocess
import zipfile  # <--- ADDED for Zipping

from pathlib import Path
from typing import Optional, Dict, List, Union
from fastapi import FastAPI, Request, Depends, HTTPException, status
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from threading import Lock

app = FastAPI()

# ───────── CONFIG ─────────

NODE_WORKDIR = "/app"   # Ensure generate_login_incognito.js is here
GENERATE_SCRIPT = "generate_login_incognito.js"
NODE_ID = os.getenv("NODE_ID", "vm-unknown")
NODE_PUBLIC_URL = os.getenv("NODE_PUBLIC_URL", "")  # e.g. "http://209.xx.xx.xx:8000"

# Maximum parallel generate-video jobs on this VM
MAX_CONCURRENT_JOBS = 1

PROMPTS_DIR = "/app/gemini_prompts"
OUTPUT_ROOT = "/app/output"     # /root/output/<job_id>/...
JOBS_DIR    = "/app/jobs"       # /root/jobs/<job_id>/meta.json

Path(OUTPUT_ROOT).mkdir(parents=True, exist_ok=True)
Path(JOBS_DIR).mkdir(parents=True, exist_ok=True)
Path(PROMPTS_DIR).mkdir(parents=True, exist_ok=True)

# Static mount for videos: /output/<job_id>/<filename>.mp4
app.mount("/output", StaticFiles(directory=OUTPUT_ROOT), name="output")

# ───────── AUTH CONFIG ─────────

LOGIN_API_KEY = "autoflowlearn-veo3-gemini-login"
JOB_API_KEY   = "autoflowlearn-veo3-gemini-job"

def _extract_bearer_token(request: Request) -> str:
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth:
        return ""
    parts = auth.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    if len(parts) == 1:
        return parts[0]
    return ""

def require_job_key(request: Request):
    token = _extract_bearer_token(request)
    if not JOB_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="JOB_API_KEY not configured on server",
        )
    if token != JOB_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized for job endpoints",
        )
    return True

# ───────── MODELS ─────────

class GenerateVideoRequest(BaseModel):
    prompts_base64: str = Field(..., description="Base64 of prompts.txt content")
    max_tabs: int = Field(10, ge=1, le=40)
    # Added fields to pass credentials dynamically to the Node script
    email: Optional[str] = Field("admin1@imagescraftai.live", description="Gemini Email")
    password: Optional[str] = Field("HafsaHaris11$$", description="Gemini Password")

# ───────── HELPERS: SYSTEM / FILES ─────────

def run_node_async(
    cmd: List[str],
    env_extra: Optional[Dict[str, str]] = None,
) -> int:
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)

    # cwd=NODE_WORKDIR important so it finds the JS file
    proc = subprocess.Popen(
        cmd,
        env=env,
        cwd=NODE_WORKDIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return proc.pid

def save_prompts_from_base64(b64_str: str) -> str:
    if "," in b64_str:
        b64_str = b64_str.split(",", 1)[1]
    raw = base64.b64decode(b64_str)
    text = raw.decode("utf-8", errors="replace")
    
    fname = f"prompts_{uuid.uuid4().hex}.txt"
    fpath = os.path.join(PROMPTS_DIR, fname)
    
    with open(fpath, "w", encoding="utf-8") as f:
        f.write(text)
    return fpath

def count_nonempty_lines(path: str) -> int:
    count = 0
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            if line.strip():
                count += 1
    return count

def list_mp4_files_in_dir(directory: str) -> List[str]:
    if not os.path.exists(directory):
        return []
    return sorted(
        f
        for f in os.listdir(directory)
        if f.lower().endswith(".mp4")
        and os.path.isfile(os.path.join(directory, f))
    )

def ensure_zip_created(directory: str) -> str:
    """
    Creates a zip file containing all MP4s in the directory.
    Returns the filename of the zip (e.g., 'all_scenes.zip').
    """
    zip_filename = "all_scenes.zip"
    zip_path = os.path.join(directory, zip_filename)
    
    # Check if already exists (optional: overwrite logic if needed)
    if os.path.exists(zip_path):
        return zip_filename
        
    mp4_files = list_mp4_files_in_dir(directory)
    if not mp4_files:
        return ""

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for file in mp4_files:
            file_path = os.path.join(directory, file)
            zf.write(file_path, arcname=file)
            
    return zip_filename

def list_all_mp4_files_flat() -> List[str]:
    all_files: List[str] = []
    for root, _, files in os.walk(OUTPUT_ROOT):
        for name in files:
            if not name.lower().endswith(".mp4"):
                continue
            full = os.path.join(root, name)
            rel = os.path.relpath(full, OUTPUT_ROOT)
            all_files.append(rel.replace("\\", "/"))
    all_files.sort()
    return all_files

def load_job_meta(job_id: str) -> Optional[Dict]:
    meta_path = os.path.join(JOBS_DIR, job_id, "meta.json")
    if not os.path.exists(meta_path):
        return None
    with open(meta_path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_job_meta(job_id: str, meta: Dict) -> str:
    job_dir = os.path.join(JOBS_DIR, job_id)
    Path(job_dir).mkdir(parents=True, exist_ok=True)
    
    meta_path = os.path.join(job_dir, "meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    return meta_path

# ───────── CONCURRENCY (5 slots) ─────────

jobs_lock = Lock()
active_jobs: Dict[str, str] = {}   # job_id -> "running"

def get_active_jobs_count() -> int:
    with jobs_lock:
        return len(active_jobs)

def register_job(job_id: str):
    with jobs_lock:
        active_jobs[job_id] = "running"

def release_job(job_id: str):
    with jobs_lock:
        active_jobs.pop(job_id, None)

# ───────── SCENE PARSING & ORDERING ─────────

SCENE_RE = re.compile(r"^scene_(\d+)_")  # scene_1_..., scene_10_...

def build_scene_map(files: List[str]) -> Dict[int, str]:
    scene_map: Dict[int, str] = {}
    for name in files:
        m = SCENE_RE.match(name)
        if not m:
            continue
        scene_num = int(m.group(1))
        if scene_num in scene_map:
            # Keep latest if multiple
            if name > scene_map[scene_num]:
                scene_map[scene_num] = name
        else:
            scene_map[scene_num] = name
    return scene_map

def build_outputs_strict(
    req_output_dir: str,
    base_url: str,
    job_id: str,
    expected_scenes: int,
) -> (List[Dict[str, str]], bool):
    
    files = list_mp4_files_in_dir(req_output_dir)
    scene_map = build_scene_map(files)
    
    outputs: List[Dict[str, str]] = []
    all_present = True 
    
    for i in range(1, expected_scenes + 1):
        key = f"scene{i}"
        fname = scene_map.get(i)
        
        if not fname:
            outputs.append({key: "failed"})
            all_present = False
        else:
            url = f"{base_url}/output/{job_id}/{fname}"
            outputs.append({key: url})
            
    return outputs, all_present

def build_ordered_outputs_flat(base_url: str) -> List[Dict[str, str]]:
    rel_paths = list_all_mp4_files_flat()
    scene_map: Dict[int, str] = {}
    
    for rel in rel_paths:
        name = rel.split("/")[-1]
        m = SCENE_RE.match(name)
        if not m:
            continue
        n = int(m.group(1))
        
        if n in scene_map:
            if rel > scene_map[n]:
                scene_map[n] = rel
        else:
            scene_map[n] = rel
            
    if not scene_map:
        return []
        
    max_n = max(scene_map.keys())
    outputs: List[Dict[str, str]] = []
    
    for i in range(1, max_n + 1):
        key = f"scene{i}"
        if i in scene_map:
            rel = scene_map[i]
            url = f"{base_url}/output/{rel}"
            outputs.append({key: url})
        else:
            outputs.append({key: "failed"})
            
    return outputs

# ───────── ROUTES ─────────

@app.get("/")
def health():
    return {"status": "ok", "active_jobs": get_active_jobs_count(), "node_id": NODE_ID}

@app.post("/generate-video")
def generate_video(
    req: GenerateVideoRequest,
    request: Request,
    _auth: bool = Depends(require_job_key),
):
    prompts_path: Optional[str] = None
    job_id: Optional[str] = None

    try:
        # concurrency check
        active = get_active_jobs_count()
        if active >= MAX_CONCURRENT_JOBS:
            return {
                "ok": False,
                "status": "limit_reached",
                "message": f"Maximum concurrent jobs reached ({MAX_CONCURRENT_JOBS}). Please try again later.",
                "active_jobs": active,
            }

        # Decode prompts
        prompts_path = save_prompts_from_base64(req.prompts_base64)
        expected_scenes = count_nonempty_lines(prompts_path)

        # Job id & dirs
        job_id = uuid.uuid4().hex
        req_output_dir = os.path.join(OUTPUT_ROOT, job_id)
        Path(req_output_dir).mkdir(parents=True, exist_ok=True)

        # Initial job meta
        meta = {
            "job_id": job_id,
            "status": "pending",
            "prompts_file": prompts_path,
            "output_dir": req_output_dir,
            "expected_scenes": expected_scenes,
            "max_tabs": int(req.max_tabs),
            "email": req.email,
            "node_id": NODE_ID,
            "node_public_url": NODE_PUBLIC_URL,
        }
        meta_path = save_job_meta(job_id, meta)

        # register active job
        register_job(job_id)

        # Launch Node in background
        max_tabs = max(1, min(40, req.max_tabs))
        
        cmd = [
            "xvfb-run", "-a", "node",
            GENERATE_SCRIPT,
            f"--promptFile={prompts_path}",
            f"--outputDir={req_output_dir}",
            f"--jobMeta={meta_path}",
            f"--maxTabs={max_tabs}",
            f"--email={req.email}",
            f"--password={req.password}",
            "--headless=false" 
        ]

        env_extra = {
            "HEADLESS": "false",
        }

        pid = run_node_async(cmd, env_extra=env_extra)

        return {
            "ok": True,
            "status": "pending_job",
            "job_id": job_id,
            "pid": pid,
            "expected_scenes": expected_scenes,
            "active_jobs_now": get_active_jobs_count(),
            "node_id": NODE_ID,
            "node_public_url": NODE_PUBLIC_URL,
        }

    except Exception as e:
        if job_id is not None:
            release_job(job_id)
        return {"ok": False, "status": "error", "error": str(e)}

@app.get("/job-status")
def job_status(
    job_id: str,
    request: Request,
    response_format: str = "json",  # 'json' or 'zip'
    _auth: bool = Depends(require_job_key),
):
    """
    Check job status.
    - response_format='json' (Default): Returns list of MP4 URLs per scene.
    - response_format='zip': Creates a ZIP file of all MP4s and returns its URL.
    """
    meta = load_job_meta(job_id)
    if not meta:
        return {"ok": False, "status": "not_found", "job_id": job_id}

    status_str = meta.get("status", "pending")
    expected_scenes = int(meta.get("expected_scenes", 0))
    output_dir = meta.get("output_dir", os.path.join(OUTPUT_ROOT, job_id))
    base_url = str(request.base_url).rstrip("/")

    # Agar job finished hai -> active_jobs se hata do
    if status_str in ("completed", "failed", "error"):
        release_job(job_id)
        
        # === ZIP LOGIC ===
        if response_format == "zip":
            # Zip create karo
            zip_name = ensure_zip_created(output_dir)
            if zip_name:
                zip_url = f"{base_url}/output/{job_id}/{zip_name}"
                return {
                    "ok": True,
                    "status": status_str,
                    "job_id": job_id,
                    "zip_url": zip_url,
                    "message": "Download the zip file containing all scenes."
                }
            else:
                 return {
                    "ok": False,
                    "status": "zip_failed",
                    "message": "Could not create zip or no files found."
                }

        # === DEFAULT JSON LOGIC ===
        outputs, success = build_outputs_strict(
            req_output_dir=output_dir,
            base_url=base_url,
            job_id=job_id,
            expected_scenes=expected_scenes,
        )

        response = {
            "ok": True,
            "status": status_str,
            "job_id": job_id,
            "expected_scenes": expected_scenes,
            "success_full": success,
            "outputs": outputs,
            "active_jobs_now": get_active_jobs_count(),
        }
        
        # meta me extra fields (error, reason, etc.)
        for k, v in meta.items():
            if k not in response:
                response[k] = v
        
        return response

    # still running
    return {
        "ok": True,
        "status": "pending",
        "job_id": job_id,
        "expected_scenes": expected_scenes,
        "active_jobs_now": get_active_jobs_count(),
    }

@app.get("/list-outputs")
def list_outputs(
    request: Request,
    folder_id: Optional[str] = None,
    _auth: bool = Depends(require_job_key),
):
    base_url = str(request.base_url).rstrip("/")
    
    if folder_id:
        req_dir = os.path.join(OUTPUT_ROOT, folder_id)
        files = list_mp4_files_in_dir(req_dir)
        scene_map = build_scene_map(files)
        outputs: List[Dict[str, str]] = []
        
        if scene_map:
            max_scene = max(scene_map.keys())
            for i in range(1, max_scene + 1):
                key = f"scene{i}"
                if i in scene_map:
                    fname = scene_map[i]
                    url = f"{base_url}/output/{folder_id}/{fname}"
                    outputs.append({key: url})
                else:
                    outputs.append({key: "failed"})
                    
        return {"folder_id": folder_id, "outputs": outputs}
    else:
        outputs = build_ordered_outputs_flat(base_url)
        return {"outputs": outputs}
