const transformUrl = (url) => {
    let videoUrl = url.trim();
    if (videoUrl.includes('drive.google.com') && videoUrl.includes('/view')) {
        videoUrl = videoUrl.replace(/\/view(\?.*)?$/, '/preview');
    }
    return videoUrl;
};

const testUrls = [
    "https://drive.google.com/file/d/1MZEhV-0jiNWEABQtB1FNRPME6IxmE1RC/view?usp=drive_link",
    "https://drive.google.com/file/d/1MZEhV-0jiNWEABQtB1FNRPME6IxmE1RC/view",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
];

testUrls.forEach(url => {
    console.log(`Original: ${url}`);
    console.log(`Transformed: ${transformUrl(url)}`);
    console.log('---');
});
