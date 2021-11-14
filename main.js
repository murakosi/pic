const {
    app,
    BrowserWindow,
    ipcMain,
    dialog
} = require("electron");
const path = require("path");
const trash = require('trash');
const sharp = require('sharp');
const fs = require("fs");
const proc = require('child_process');

sharp.cache(false);

let mainWindow;

app.on('ready', () => {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
        nodeIntegration: false, // is default value after Electron v5
        contextIsolation: true, // protect against prototype pollution
        enableRemoteModule: false, // turn off remote
        preload: path.join(__dirname, "preload.js") // use a preload script
        }
    })

    // Electronに表示するhtmlを絶対パスで指定（相対パスだと動かない）
    mainWindow.loadURL('file://' + __dirname + '/index.html');

    let folder;

    let currentIndex = 0;

    let targetFile = null;

    const targetfiles = [];

    const directLaunch = process.argv.length > 1 && process.argv[1] != "main.js";;

    const dir = path.join(app.getPath("userData"), "temp");

    const savedPathFile = path.join(dir,"path.txt");
    let currentDir;
    if(fs.existsSync(savedPathFile)){
        currentDir = fs.readFileSync(savedPathFile, {encoding:"utf8"});
    }

    init();

    mainWindow.maximize();

    //mainWindow.webContents.openDevTools()

    mainWindow.on('closed', function() {
        mainWindow = null;
    });

    function init(){

        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        }

        folder = null;

        currentIndex = 0;

        targetFile = null;

        targetfiles.length = 0;
    }

    function loadImage(args){

        targetFile = args.name;
        currentDir = path.dirname(args.path);

        targetfiles.length = 0;
        fs.readdir(currentDir, (err, files) => {
            files.sort(sortByName).forEach((file, index) => {
                if(targetFile == file){
                    currentIndex = index;
                }
                targetfiles.push(currentDir + "\\" + file);
            })
            respond(targetfiles[currentIndex]);
        });
    }

    function sortByName(a, b){
        return a.replace(path.extname(a), "") - b.replace(path.extname(b), "");
    }

    async function respond(filePath, angle){
        if(!filePath){
            mainWindow.webContents.send("afterfetch", null);
            return;
        }

        let orientation = angle;
        if(!angle){
            orientation = await (await sharp(filePath).metadata()).orientation;
        }

        const data = {
            name: path.basename(filePath),
            path:filePath,
            counter: (currentIndex + 1) + " / " + targetfiles.length,
            angle:orientation
        }

        mainWindow.webContents.send("afterfetch", data);

    }

    ipcMain.on("domready", (event, args) => {
        if(directLaunch && targetfiles.length == 0){
            loadImage({name:path.basename(process.argv[1]), path:process.argv[1]});
        }else if(targetfiles.length > 0){
            respond(targetfiles[currentIndex]);
        }else{
            respond();
        }
    });

    ipcMain.on("drop", (event, args) => {
        loadImage(args);
    });


    ipcMain.on("fetch", (event, args) => {

        if(targetfiles.length <= 0){
            respond();
            return;
        }

        if(args == 0){
            currentIndex = 0;
        }

        if(args == 1 && targetfiles.length - 1 > currentIndex){
            currentIndex++;
        }

        if(args == -1 && currentIndex > 0){
            currentIndex--;
        }

        respond(targetfiles[currentIndex]);
    });

    ipcMain.on("delete", async (event, args) => {

        if(targetfiles.length <= 0){
            respond();
            return;
        }

        try{

            const result = await trash(targetfiles[currentIndex]);

            targetfiles.splice(currentIndex, 1);

            if(currentIndex > 0){
                currentIndex--;
            }

            if(targetfiles.length - 1 > currentIndex){
                currentIndex++;
            }

            respond(targetfiles[currentIndex]);

        }catch(ex){
            mainWindow.webContents.send("onError", ex.message);
        }
    });

    ipcMain.on("reveal", (event, args) => {

        if(targetfiles.length <= 0){
            return;
        }

        proc.exec('explorer /e,/select,"' + targetfiles[currentIndex] + '"');

    });

    ipcMain.on("open", async (event, args) => {

        const result = await dialog.showOpenDialog(null, {
            properties: ["openFile"],
            title: "Select image",
            defaultPath: currentDir ? currentDir :'.',
            filters: [
                {name: "image file", extensions: ["jpeg","jpg","png","ico","gif"]}
            ]
        });

        if(result.filePaths.length == 1){
            const file = result.filePaths[0];
            currentDir = path.dirname(file);
            fs.writeFileSync(path.join(dir,"path.txt"), currentDir);
            loadImage({name:path.basename(file), path:file});
        }

    });

    ipcMain.on("save", (event, args) => {

        if(targetfiles.length <= 0){
            return;
        }

        fs.writeFileSync(path.join(dir,"file.txt"), targetfiles[currentIndex]);

        if(currentDir){
            fs.writeFileSync(path.join(dir,"path.txt"), currentDir);
        }
    });

    ipcMain.on("restore", (event, args) => {

        const body = fs.readFileSync(path.join(dir,"file.txt"), {encoding:"utf8"});

        loadImage({name:path.basename(body), path:body});
    });

    ipcMain.on("rotate", async (event, args) => {

        try{
            /*
            const buffer = await sharp(targetfiles[currentIndex])
                .rotate(args.angle)
                .withMetadata()
                .toBuffer();

            const result = await sharp(buffer).toFile(targetfiles[currentIndex]);
*/

            const buffer = await sharp(targetfiles[currentIndex])
                                .withMetadata({orientation: args.angle})
                                .toBuffer();

            const result = await sharp(buffer).withMetadata().toFile(targetfiles[currentIndex]);

            respond(targetfiles[currentIndex], args.angle);

        }catch(ex){
            mainWindow.webContents.send("onError", ex.message);
        }
    });
});