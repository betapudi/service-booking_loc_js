import os

def write_folder_contents_to_file(start_path, output_file, skip_folders, skip_extensions):
    """
    Traverses a directory, skips specified folders and file extensions,
    and writes the content of all other files to a text file.
    """
    with open(output_file, 'w', encoding='utf-8') as outfile:
        for dirpath, dirnames, filenames in os.walk(start_path):
            # Exclude folders
            dirnames[:] = [d for d in dirnames if d not in skip_folders]
            
            for filename in filenames:
                file_extension = os.path.splitext(filename)[1].lower()
                
                # Check if the file's extension is in the skip list
                if file_extension not in skip_extensions:
                    full_path = os.path.join(dirpath, filename)
                    try:
                        with open(full_path, 'r', encoding='utf-8') as infile:
                            outfile.write(f"--- File: {full_path} ---\n")
                            outfile.write(infile.read())
                            outfile.write("\n\n")
                    except Exception as e:
                        # Skip files that can't be read (e.g., binary files)
                        print(f"Skipping file: {full_path} due to error: {e}")

# --- Configuration ---
# Set the root directory to start the search
ROOT_FOLDER = "backend" # Example for Windows
# ROOT_FOLDER = "/home/user/your_folder" # Example for Linux/macOS

# Define the folders to skip
FOLDERS_TO_SKIP = ['venv', '__pycache__', '.git', 'bkp', 'node_modules','dist','migrations',
                   'build','.idea','.gitignore','.vscode','tests','docs','.next']

# Define the file extensions to skip
EXTENSIONS_TO_SKIP = ['.json','.txt','.svg','.jpg', '.gitignore','.png','.ico', '.exe', '.zip', '.bin', '.dll', '.so', '.dylib',
                      '.class', '.jar', '.pyc', '.pyo', '.db', '.sqlite', '.mp3', '.mp4', '.avi', '.mov',
                      '.pdf', '.docx', '.xlsx', '.pptx', '.ttf', '.woff', '.woff2', '.eot', '.otf','.config.js',
                      ' copy.js','.tmp.drivedownload','.tmp.driveupload']

# Set the name of the output text file
OUTPUT_FILE_NAME = "backend_all_content.txt"

# Run the function
write_folder_contents_to_file(ROOT_FOLDER, OUTPUT_FILE_NAME, FOLDERS_TO_SKIP, EXTENSIONS_TO_SKIP)

print(f"Content successfully written to {OUTPUT_FILE_NAME}")
